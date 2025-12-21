const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

// Import utility modules
const { validateGoogleToken, validateCognitoToken, validateToken } = require('./auth/tokenValidator');
const { validateDatabaseUser, createDatabaseToken } = require('./auth/databaseAuth');
const { checkUserPermission, createRBACDeniedResponse } = require('./auth/rbacChecker');
const { createRateLimiter } = require('./middleware/rateLimiter');
const { createLogger } = require('./utils/logger');
const { filterRequest } = require('./middleware/requestFilter');
const { corsHeaders } = require('./utils/cors');
const { validateQueryInput, sanitizeValue, ALLOWED_OPERATORS } = require('./utils/sqlProtection');

// Initialize logger
const logger = createLogger();

// Initialize rate limiter
const rateLimiter = createRateLimiter();

// Note: Environment variables are accessed directly via process.env
// The Lambda environment should have all required variables set

/**
 * Main Lambda handler
 */
exports.handler = async (event, context) => {
  const requestId = uuidv4();
  const startTime = Date.now();

  // Add request ID to context for logging
  context.requestId = requestId;

  // Basic console logging to ensure CloudWatch gets something
  console.log(`[${new Date().toISOString()}] Lambda invoked - RequestID: ${requestId}`);

  logger.info('Request started', {
    requestId,
    method: event.requestContext?.http?.method || event.httpMethod,
    path: event.rawPath || event.path,
    userAgent: event.headers?.['User-Agent'],
    sourceIp: event.requestContext?.identity?.sourceIp || event.requestContext?.http?.sourceIp,
    queryParams: event.rawQueryString || event.queryStringParameters
  });

  try {
    // Extract origin for CORS
    const origin = event.headers?.Origin || event.headers?.origin;

    // Handle preflight CORS requests
    if ((event.requestContext?.http?.method || event.httpMethod) === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: corsHeaders(origin),
        body: ''
      };
    }

    // Handle database login endpoint
    const httpMethod = event.requestContext?.http?.method || event.httpMethod;
    if ((event.rawPath === '/auth/login' || event.path === '/auth/login') && httpMethod === 'POST') {
      return await handleDatabaseLogin(event, requestId, origin);
    }

    // Rate limiting check
    const clientId = getClientIdentifier(event);
    const rateLimitResult = await rateLimiter.check(clientId);

    if (!rateLimitResult.allowed) {
      logger.warn('Rate limit exceeded', {
        requestId,
        clientId,
        remaining: rateLimitResult.remaining,
        resetTime: rateLimitResult.resetTime
      });

      return {
        statusCode: 429,
        headers: {
          ...corsHeaders(origin),
          'X-RateLimit-Limit': rateLimitResult.limit.toString(),
          'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
          'X-RateLimit-Reset': rateLimitResult.resetTime.toString()
        },
        body: JSON.stringify({
          error: 'Rate limit exceeded',
          message: 'Too many requests. Please try again later.',
          requestId
        })
      };
    }

    // Handle proxy endpoints that use request body instead of query parameters
    const path = event.rawPath || event.path;
    if (path.startsWith('/proxy/') && httpMethod === 'POST') {
      // Check if this is an exempted function call
      const isExempted = await isExemptedFunction(event, requestId);

      if (isExempted) {
        // Skip authentication for exempted functions
        logger.info('Exempted function call - skipping authentication', {
          requestId,
          path,
          functionName: isExempted.functionName
        });

        // Create a mock user for exempted functions
        const mockUser = {
          sub: 'anonymous',
          email: 'anonymous@system.local',
          provider: 'anonymous',
          user_id: 'anonymous',
          exempted: true
        };

        return await handleProxyEndpoint(event, mockUser, requestId, origin);
      }
    }

    // Extract and validate authentication token
    const authResult = await validateAuthentication(event, requestId);
    if (!authResult.valid) {
      return authResult.response;
    }

    // Handle authenticated proxy endpoints
    if (path.startsWith('/proxy/') && httpMethod === 'POST') {
      return await handleProxyEndpoint(event, authResult.user, requestId, origin);
    }

    // Request filtering
    const filterResult = filterRequest(event, authResult.user);
    if (!filterResult.allowed) {
      logger.warn('Request blocked by filter', {
        requestId,
        reason: filterResult.reason,
        path: event.rawPath || event.path,
        userId: authResult.user.sub
      });

      return {
        statusCode: 403,
        headers: corsHeaders(origin),
        body: JSON.stringify({
          error: 'Forbidden',
          message: filterResult.reason,
          requestId
        })
      };
    }

    // Proxy request to Supabase
    const proxyResult = await proxyToSupabase(event, authResult.user, requestId);

    // Log successful request
    const duration = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] Request completed - RequestID: ${requestId}, Status: ${proxyResult.statusCode}, Duration: ${duration}ms`);

    logger.info('Request completed', {
      requestId,
      statusCode: proxyResult.statusCode,
      duration,
      userId: authResult.user.sub
    });

    return {
      ...proxyResult,
      headers: mergeCorsHeaders(proxyResult.headers, corsHeaders(origin), {
        'X-Request-ID': requestId,
        'X-RateLimit-Remaining': rateLimitResult.remaining.toString()
      })
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[${new Date().toISOString()}] Request failed - RequestID: ${requestId}, Error: ${error.message}, Duration: ${duration}ms`);
    console.error('Stack trace:', error.stack);

    logger.error('Request failed', {
      requestId,
      error: error.message,
      stack: error.stack,
      duration
    });

    return {
      statusCode: 500,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
        requestId
      })
    };
  }
};

/**
 * Extract client identifier for rate limiting
 */
function getClientIdentifier(event) {
  // Try to get user ID from token first, fallback to IP
  const authHeader = event.headers?.Authorization || event.headers?.authorization;
  if (authHeader) {
    try {
      const token = authHeader.replace(/^Bearer\s+/, '');
      const decoded = jwt.decode(token);
      if (decoded?.sub) {
        return `user:${decoded.sub}`;
      }
    } catch (error) {
      // Fallback to IP
    }
  }

  return `ip:${event.requestContext?.identity?.sourceIp || event.requestContext?.http?.sourceIp || 'unknown'}`;
}

/**
 * Check if a function call is exempted from authentication
 */
async function isExemptedFunction(event, requestId) {
  try {
    // Only check for /proxy/function endpoints
    const path = event.rawPath || event.path;
    if (path !== '/proxy/function') {
      return false;
    }

    // Parse the request body to get function name
    const body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body) : '{}';
    const requestData = JSON.parse(body);
    const functionName = requestData.function;

    if (!functionName) {
      return false;
    }

    // Get exempted functions from environment variable
    const exemptedFunctionsStr = process.env.EXEMPTED_FUNCTIONS || '';
    if (!exemptedFunctionsStr) {
      return false;
    }

    // Parse exempted functions (comma-separated list)
    const exemptedFunctions = exemptedFunctionsStr
      .split(',')
      .map(func => func.trim())
      .filter(func => func.length > 0);

    // Check if the function is in the exempted list
    const isExempted = exemptedFunctions.includes(functionName);

    if (isExempted) {
      logger.info('Function is exempted from authentication', {
        requestId,
        functionName,
        exemptedFunctions
      });

      return {
        functionName,
        exempted: true
      };
    }

    return false;

  } catch (error) {
    logger.warn('Error checking exempted function', {
      requestId,
      error: error.message,
      body: event.body ? event.body.substring(0, 200) : 'No body'
    });
    return false;
  }
}

/**
 * Validate authentication token
 */
async function validateAuthentication(event, requestId) {
  const authHeader = event.headers?.Authorization || event.headers?.authorization;

  if (!authHeader) {
    logger.warn('Missing authorization header', { requestId });
    return {
      valid: false,
      response: {
        statusCode: 401,
        headers: corsHeaders(event.headers?.Origin || event.headers?.origin),
        body: JSON.stringify({
          error: 'Unauthorized',
          message: 'Authorization header is required',
          requestId
        })
      }
    };
  }

  const token = authHeader.replace(/^Bearer\s+/, '');

  try {
    // Use the comprehensive validateToken function that supports all providers
    const user = await validateToken(token);

    logger.info(`${user.provider} authentication successful`, {
      requestId,
      userId: user.sub,
      email: user.email,
      provider: user.provider
    });

    return { valid: true, user };

  } catch (error) {
    logger.warn('Token validation failed for all providers', {
      requestId,
      error: error.message
    });

    return {
      valid: false,
      response: {
        statusCode: 401,
        headers: corsHeaders(event.headers?.Origin || event.headers?.origin),
        body: JSON.stringify({
          error: 'Unauthorized',
          message: 'Invalid or expired token',
          requestId
        })
      }
    };
  }
}

/**
 * Handle database login endpoint
 */
async function handleDatabaseLogin(event, requestId, origin = null) {
  try {
    // Parse request body
    let body;
    try {
      body = event.isBase64Encoded
        ? JSON.parse(Buffer.from(event.body, 'base64').toString())
        : JSON.parse(event.body);
    } catch (error) {
      logger.warn('Invalid JSON in login request', { requestId });
      return {
        statusCode: 400,
        headers: corsHeaders(origin),
        body: JSON.stringify({
          error: 'Bad Request',
          message: 'Invalid JSON in request body',
          requestId
        })
      };
    }

    // Handle Google OAuth login
    if (body.provider === 'google') {
      return await handleGoogleOAuthLogin(body, requestId, origin);
    }

    // Validate required fields for database login
    if (!body.email || !body.password) {
      logger.warn('Missing email or password in login request', { requestId });
      return {
        statusCode: 400,
        headers: corsHeaders(origin),
        body: JSON.stringify({
          error: 'Bad Request',
          message: 'Email and password are required',
          requestId
        })
      };
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      logger.warn('Invalid email format in login request', { requestId, email: body.email });
      return {
        statusCode: 400,
        headers: corsHeaders(origin),
        body: JSON.stringify({
          error: 'Bad Request',
          message: 'Invalid email format',
          requestId
        })
      };
    }

    // Check if database auth is enabled
    if (process.env.ENABLE_DATABASE_AUTH !== 'true') {
      logger.warn('Database authentication is disabled', { requestId });
      return {
        statusCode: 503,
        headers: corsHeaders(origin),
        body: JSON.stringify({
          error: 'Service Unavailable',
          message: 'Database authentication is not available',
          requestId
        })
      };
    }

    // Validate user credentials
    const user = await validateDatabaseUser(
      body.email,
      body.password,
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    if (!user) {
      logger.warn('Invalid login attempt', { requestId, email: body.email });
      return {
        statusCode: 401,
        headers: corsHeaders(origin),
        body: JSON.stringify({
          error: 'Unauthorized',
          message: 'Invalid email or password',
          requestId
        })
      };
    }

    // Update login tracking
    await updateUserLoginTracking(user.user_id, user.email, 'database', requestId);

    // Create JWT token
    const token = createDatabaseToken(user, process.env.JWT_SECRET);

    logger.info('Database login successful', {
      requestId,
      userId: user.sub,
      email: user.email
    });

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(origin),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        token,
        user: {
          id: user.user_id,
          email: user.email,
          provider: user.provider
        },
        requestId
      })
    };

  } catch (error) {
    logger.error('Database login error', {
      requestId,
      error: error.message,
      stack: error.stack
    });

    return {
      statusCode: 500,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: 'Login failed due to server error',
        requestId
      })
    };
  }
}

/**
 * Handle Google OAuth login
 */
async function handleGoogleOAuthLogin(body, requestId, origin = null) {
  try {
    const { access_token, id_token } = body;

    // Validate required OAuth data
    if (!id_token) {
      logger.warn('Missing id_token in OAuth request', { requestId });
      return {
        statusCode: 400,
        headers: corsHeaders(origin),
        body: JSON.stringify({
          error: 'Bad Request',
          message: 'Missing id_token',
          requestId
        })
      };
    }

    // Parse and validate Google JWT id_token
    const user_info = await parseGoogleIdToken(id_token, requestId);
    if (!user_info) {
      logger.warn('Failed to parse or validate Google JWT id_token', { requestId });
      return {
        statusCode: 401,
        headers: corsHeaders(origin),
        body: JSON.stringify({
          error: 'Unauthorized',
          message: 'Invalid or expired id_token',
          requestId
        })
      };
    }

    // Verify user exists in Supabase users table
    const userExists = await verifyUserExistsInSupabase(user_info.email, requestId);
    if (!userExists.exists) {
      logger.warn('Google OAuth user not found in users table', {
        requestId,
        email: user_info.email
      });
      return {
        statusCode: 401,
        headers: corsHeaders(origin),
        body: JSON.stringify({
          error: 'Access Denied',
          message: 'Your email is not registered in the system. Please contact an administrator.',
          requestId
        })
      };
    }

    // Create user object for JWT
    const user = {
      user_id: userExists.user.id,
      sub: userExists.user.id,
      email: user_info.email,
      name: user_info.name,
      picture: user_info.picture,
      provider: 'google',
      google_id: user_info.id,
      verified_email: user_info.verified_email || true
    };

    // Update login tracking
    await updateUserLoginTracking(user.user_id, user.email, 'google', requestId);

    // Create JWT token
    const token = createDatabaseToken(user, process.env.JWT_SECRET);

    logger.info('Google OAuth login successful', {
      requestId,
      userId: user.sub,
      email: user.email,
      provider: 'google'
    });

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(origin),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        token,
        user: {
          id: user.user_id,
          email: user.email,
          name: user.name,
          picture: user.picture,
          provider: user.provider
        },
        requestId
      })
    };

  } catch (error) {
    logger.error('Google OAuth login error', {
      requestId,
      error: error.message,
      stack: error.stack
    });

    return {
      statusCode: 500,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: 'OAuth login failed due to server error',
        requestId
      })
    };
  }
}

/**
 * Fetch Google client ID from identity_providers table
 */
async function getGoogleClientId(requestId) {
  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/identity_providers?provider_name=eq.google&select=config_data`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY
      },
      timeout: 10000
    });

    if (!response.ok) {
      logger.error('Failed to fetch Google client ID from identity_providers table', {
        requestId,
        status: response.status,
        statusText: response.statusText
      });
      throw new Error('Failed to fetch Google client ID');
    }

    const providers = await response.json();

    if (!providers || providers.length === 0) {
      logger.error('Google provider not found in identity_providers table', { requestId });
      throw new Error('Google provider not configured');
    }

    const googleProvider = providers[0];
    const clientId = googleProvider.config_data?.client_id;

    if (!clientId) {
      logger.error('Google client_id not found in provider config', {
        requestId,
        configData: googleProvider.config_data
      });
      throw new Error('Google client_id not configured');
    }

    logger.debug('Google client ID fetched successfully', {
      requestId,
      clientId: clientId.substring(0, 20) + '...' // Log partial client ID for debugging
    });

    return clientId;

  } catch (error) {
    logger.error('Error fetching Google client ID', {
      requestId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Parse and validate Google JWT id_token
 */
async function parseGoogleIdToken(id_token, requestId) {
  try {
    const jwt = require('jsonwebtoken');
    const jwksClient = require('jwks-rsa');

    // Fetch Google client ID from database
    const googleClientId = await getGoogleClientId(requestId);

    // Create JWKS client for Google
    const client = jwksClient({
      jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
      cache: true,
      cacheMaxAge: 86400 * 1000, // 24 hours
      timeout: 10000 // 10 seconds
    });

    // Function to get signing key
    const getKey = (header, callback) => {
      client.getSigningKey(header.kid, (err, key) => {
        if (err) {
          logger.warn('Failed to get signing key from Google JWKS', {
            requestId,
            error: err.message,
            kid: header.kid
          });
          return callback(err);
        }
        const signingKey = key.publicKey || key.rsaPublicKey;
        callback(null, signingKey);
      });
    };

    // Verify and decode the JWT
    const decoded = await new Promise((resolve, reject) => {
      jwt.verify(id_token, getKey, {
        audience: googleClientId,
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        algorithms: ['RS256']
      }, (err, decoded) => {
        if (err) {
          logger.warn('JWT verification failed', {
            requestId,
            error: err.message,
            name: err.name
          });
          return reject(err);
        }
        resolve(decoded);
      });
    });

    // Validate required fields
    if (!decoded.email || !decoded.sub) {
      logger.warn('Invalid JWT payload - missing required fields', {
        requestId,
        hasEmail: !!decoded.email,
        hasSub: !!decoded.sub,
        aud: decoded.aud,
        iss: decoded.iss
      });
      return null;
    }

    // Check token expiration
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp < now) {
      logger.warn('JWT token has expired', {
        requestId,
        exp: decoded.exp,
        now: now,
        email: decoded.email
      });
      return null;
    }

    logger.info('Successfully validated Google JWT id_token', {
      requestId,
      email: decoded.email,
      email_verified: decoded.email_verified,
      aud: decoded.aud,
      iss: decoded.iss,
      exp: decoded.exp,
      hasName: !!decoded.name,
      hasPicture: !!decoded.picture
    });

    return {
      id: decoded.sub,
      email: decoded.email,
      name: decoded.name || '',
      picture: decoded.picture || '',
      verified_email: decoded.email_verified || false
    };

  } catch (error) {
    logger.error('Error parsing Google JWT id_token', {
      requestId,
      error: error.message,
      stack: error.stack
    });
    return null;
  }
}

/**
 * Update user login tracking in Supabase users table
 */
async function updateUserLoginTracking(userId, email, provider, requestId) {
  try {
    logger.info('Updating user login tracking', {
      requestId,
      userId,
      email,
      provider
    });

    const updateData = {
      last_login_at: new Date().toISOString(),
      identity_provider: provider,
      updated_at: new Date().toISOString()
    };

    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(updateData)
    });

    if (!response.ok) {
      throw new Error(`Failed to update user login tracking: ${response.status} ${response.statusText}`);
    }

    logger.info('Successfully updated user login tracking', {
      requestId,
      userId,
      email,
      provider,
      status: response.status
    });

    return true;

  } catch (error) {
    logger.error('Failed to update user login tracking', {
      requestId,
      userId,
      email,
      provider,
      error: error.message,
      stack: error.stack
    });

    // Don't fail the login process if tracking update fails
    // Just log the error and continue
    return false;
  }
}

/**
 * Verify user exists in Supabase users table
 */
async function verifyUserExistsInSupabase(email, requestId) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const response = await fetch(`${supabaseUrl}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id,email,created_at`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Supabase query failed: ${response.status}`);
    }

    const users = await response.json();

    return {
      exists: users && users.length > 0,
      user: users && users.length > 0 ? users[0] : null
    };

  } catch (error) {
    logger.error('User verification error', {
      requestId,
      email,
      error: error.message
    });
    throw new Error('Failed to verify user registration');
  }
}

/**
 * Handle proxy endpoints that use request body instead of query parameters
 */
async function handleProxyEndpoint(event, user, requestId, origin = null) {
  const path = event.rawPath || event.path;

  logger.info('Proxy endpoint called', {
    requestId,
    path,
    method: event.requestContext?.http?.method || event.httpMethod,
    userId: user.sub,
    userEmail: user.email,
    headers: {
      authorization: event.headers?.Authorization ? 'Bearer [REDACTED]' : 'Not present',
      contentType: event.headers?.['Content-Type'] || 'Not present'
    }
  });

  try {
    const body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body) : '{}';
    const requestData = JSON.parse(body);

    logger.debug('Proxy request data', {
      requestId,
      path,
      requestData: JSON.stringify(requestData, null, 2)
    });

    switch (path) {
      case '/proxy/select':
        return await handleSelectProxy(requestData, user, requestId, origin, event);
      case '/proxy/insert':
        return await handleInsertProxy(requestData, user, requestId, origin, event);
      case '/proxy/function':
        return await handleFunctionProxy(requestData, user, requestId, origin, event);
      case '/proxy/stats':
        return await handleStatsProxy(requestData, user, requestId, origin, event);
      case '/proxy/update':
        return await handleUpdateProxy(requestData, user, requestId, origin, event);
      case '/proxy/delete':
        return await handleDeleteProxy(requestData, user, requestId, origin, event);
      case '/proxy/health':
        return await handleHealthProxy(user, requestId, origin);
      default:
        logger.warn('Unknown proxy endpoint', {
          requestId,
          path,
          availableEndpoints: ['/proxy/select', '/proxy/insert', '/proxy/function', '/proxy/stats', '/proxy/update', '/proxy/delete', '/proxy/health']
        });

        return {
          statusCode: 404,
          headers: corsHeaders(origin),
          body: JSON.stringify({
            error: 'Not Found',
            message: 'Proxy endpoint not found',
            requestId
          })
        };
    }
  } catch (error) {
    logger.error('Proxy endpoint error', {
      requestId,
      error: error.message,
      stack: error.stack,
      path,
      body: event.body ? event.body.substring(0, 500) : 'No body'
    });

    return {
      statusCode: 500,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: 'Proxy request failed',
        requestId
      })
    };
  }
}

/**
 * Handle select proxy - converts request body to Supabase query parameters
 */
async function handleSelectProxy(requestData, user, requestId, origin, event) {
  const { table, config } = requestData;

  logger.info('Select proxy called', {
    requestId,
    table,
    config: JSON.stringify(config, null, 2),
    userId: user.sub
  });

  if (!table) {
    logger.warn('Select proxy missing table name', { requestId, requestData });
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        error: 'Bad Request',
        message: 'Table name is required',
        requestId
      })
    };
  }

  // Validate table name
  const { validateTableName } = require('./utils/sqlProtection');
  const tableValidation = validateTableName(table);
  if (!tableValidation.valid) {
    logger.warn('Invalid table name', {
      requestId,
      table,
      reason: tableValidation.reason
    });
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        error: 'Bad Request',
        message: tableValidation.reason,
        requestId
      })
    };
  }

  // RBAC Permission Check
  const rbacResult = await checkUserPermission(user, 'table', table, 'SELECT', requestId);
  if (!rbacResult.allowed) {
    logger.security('RBAC permission denied for SELECT', {
      requestId,
      userId: user.sub,
      email: user.email,
      table,
      role: rbacResult.role,
      reason: rbacResult.message
    });
    return createRBACDeniedResponse(rbacResult, requestId, origin);
  }

  try {
    // Validate input
    const validationResult = validateQueryInput(config);
    if (!validationResult.valid) {
      logger.warn('Select input validation failed', {
        requestId,
        reason: validationResult.reason,
        config: JSON.stringify(config, null, 2)
      });
      return {
        statusCode: 400,
        headers: corsHeaders(origin),
        body: JSON.stringify({
          error: 'Bad Request',
          message: validationResult.reason,
          requestId
        })
      };
    }

    // Build Supabase query URL
    let queryUrl = `/rest/v1/${table}`;
    const queryParams = new URLSearchParams();

    // Add select clause
    if (config?.select) {
      queryParams.append('select', config.select);
      logger.debug('Added select clause', { requestId, select: config.select });
    }

    // Add filters
    if (config?.filters) {
      logger.debug('Processing filters', { requestId, filters: config.filters });

      for (const [field, condition] of Object.entries(config.filters)) {
        if (field === 'or' && Array.isArray(condition)) {
          // Handle OR conditions
          const orConditions = condition.map(orFilter => {
            const [orField, orCondition] = Object.entries(orFilter)[0];
            const [operator, value] = Object.entries(orCondition)[0];
            const sanitizedValue = sanitizeValue(value);
            return `${orField}.${operator}.${sanitizedValue}`;
          });
          queryParams.append('or', `(${orConditions.join(',')})`);
          logger.debug('Added OR filter', { requestId, orConditions });
        } else if (typeof condition === 'object') {
          const [operator, value] = Object.entries(condition)[0];
          const sanitizedValue = sanitizeValue(value);
          queryParams.append(field, `${operator}.${sanitizedValue}`);
          logger.debug('Added filter', { requestId, field, operator, value: sanitizedValue });
        }
      }
    }

    // Add ordering
    if (config?.ordering) {
      const { field, direction = 'asc' } = config.ordering;
      queryParams.append('order', `${field}.${direction}`);
      logger.debug('Added ordering', { requestId, field, direction });
    }

    // Add pagination
    if (config?.pagination) {
      if (config.pagination.limit) {
        queryParams.append('limit', config.pagination.limit.toString());
        logger.debug('Added limit', { requestId, limit: config.pagination.limit });
      }
      if (config.pagination.offset) {
        queryParams.append('offset', config.pagination.offset.toString());
        logger.debug('Added offset', { requestId, offset: config.pagination.offset });
      }
    }

    if (queryParams.toString()) {
      queryUrl += `?${queryParams.toString()}`;
    }

    logger.info('Built Supabase query', {
      requestId,
      finalUrl: queryUrl,
      queryString: queryParams.toString()
    });

    // Create a proxy event for the Supabase call
    const proxyEvent = {
      ...event,
      rawPath: `/rest/v1/${table}`,
      rawQueryString: queryParams.toString(),
      headers: event.headers, // Include original headers for authorization
      requestContext: {
        ...event.requestContext,
        http: {
          ...event.requestContext?.http,
          method: 'GET'
        }
      },
      httpMethod: 'GET',
      body: null
    };

    logger.debug('Calling proxyToSupabase', {
      requestId,
      proxyEventPath: proxyEvent.rawPath,
      proxyEventQuery: proxyEvent.rawQueryString,
      hasHeaders: !!proxyEvent.headers,
      hasAuth: !!proxyEvent.headers?.Authorization
    });

    const result = await proxyToSupabase(proxyEvent, user, requestId);

    logger.info('Supabase response received', {
      requestId,
      statusCode: result.statusCode,
      bodyLength: result.body ? result.body.length : 0,
      hasError: result.statusCode >= 400
    });

    if (result.statusCode >= 400) {
      logger.error('Supabase returned error', {
        requestId,
        statusCode: result.statusCode,
        responseBody: result.body
      });
    }

    // Parse and wrap response
    const responseData = result.body ? JSON.parse(result.body) : [];

    const finalResponse = {
      data: responseData,
      count: Array.isArray(responseData) ? responseData.length : 1,
      requestId
    };

    logger.info('Select proxy response', {
      requestId,
      resultCount: finalResponse.count,
      dataType: Array.isArray(responseData) ? 'array' : typeof responseData
    });

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(origin),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(finalResponse)
    };

  } catch (error) {
    logger.error('Select proxy error', {
      requestId,
      error: error.message,
      stack: error.stack,
      table,
      config: JSON.stringify(config, null, 2)
    });

    return {
      statusCode: 500,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: 'Select failed',
        requestId
      })
    };
  }
}

/**
 * Handle function proxy - converts request body to Supabase RPC request
 */
async function handleFunctionProxy(requestData, user, requestId, origin, event) {
  const { function: functionName, params } = requestData;

  if (!functionName) {
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        error: 'Bad Request',
        message: 'Function name is required',
        requestId
      })
    };
  }

  // Validate function name (basic validation to prevent injection)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(functionName)) {
    logger.warn('Invalid function name', {
      requestId,
      functionName,
      reason: 'Function name contains invalid characters'
    });
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        error: 'Bad Request',
        message: 'Invalid function name. Function names must contain only letters, numbers, and underscores.',
        requestId
      })
    };
  }

  // RBAC Permission Check (even for exempted users)
  const rbacResult = await checkUserPermission(user, 'function', functionName, 'EXECUTE', requestId);
  if (!rbacResult.allowed) {
    logger.security('RBAC permission denied for FUNCTION', {
      requestId,
      userId: user.sub,
      email: user.email,
      functionName,
      role: rbacResult.role,
      reason: rbacResult.message
    });
    return createRBACDeniedResponse(rbacResult, requestId, origin);
  }

  logger.info('Function proxy called', {
    requestId,
    functionName,
    paramsKeys: params ? Object.keys(params) : [],
    userId: user.sub
  });

  try {
    // Create proxy event for the RPC call
    const proxyEvent = {
      ...event,
      rawPath: `/rest/v1/rpc/${functionName}`,
      rawQueryString: '',
      headers: event.headers, // Include original headers for authorization
      requestContext: {
        ...event.requestContext,
        http: {
          ...event.requestContext?.http,
          method: 'POST'
        }
      },
      httpMethod: 'POST',
      body: JSON.stringify(params || {}),
      isBase64Encoded: false
    };

    const result = await proxyToSupabase(proxyEvent, user, requestId);

    logger.info('Function proxy response', {
      requestId,
      statusCode: result.statusCode,
      functionName,
      userId: user.sub
    });

    // Ensure CORS headers are properly set for the response
    return {
      statusCode: result.statusCode,
      headers: mergeCorsHeaders(result.headers, corsHeaders(origin), {
        'Content-Type': 'application/json'
      }),
      body: result.body
    };

  } catch (error) {
    logger.error('Function proxy error', {
      requestId,
      error: error.message,
      stack: error.stack,
      functionName
    });

    return {
      statusCode: 500,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: 'Function call failed',
        requestId
      })
    };
  }
}

/**
 * Handle stats proxy - converts request body to multiple Supabase count queries
 */
async function handleStatsProxy(requestData, user, requestId, origin, event) {
  const { table, stats } = requestData;

  if (!table || !stats) {
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        error: 'Bad Request',
        message: 'Table and stats configuration are required',
        requestId
      })
    };
  }

  // Validate table name
  const { validateTableName } = require('./utils/sqlProtection');
  const tableValidation = validateTableName(table);
  if (!tableValidation.valid) {
    logger.warn('Invalid table name in stats', {
      requestId,
      table,
      reason: tableValidation.reason
    });
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        error: 'Bad Request',
        message: tableValidation.reason,
        requestId
      })
    };
  }

  try {
    const results = {};

    // Process each stat request
    for (const [statName, statConfig] of Object.entries(stats)) {
      const queryParams = new URLSearchParams();
      queryParams.append('select', 'count');

      // Add filters if specified
      if (statConfig.filters) {
        // Validate filters for this stat
        const filtersValidation = validateQueryInput({ filters: statConfig.filters });
        if (!filtersValidation.valid) {
          logger.warn('Invalid filters in stats config', {
            requestId,
            statName,
            reason: filtersValidation.reason
          });
          continue; // Skip this stat if filters are invalid
        }

        for (const [field, condition] of Object.entries(statConfig.filters)) {
          const [operator, value] = Object.entries(condition)[0];
          const sanitizedValue = sanitizeValue(value);
          queryParams.append(field, `${operator}.${sanitizedValue}`);
        }
      }

      const queryUrl = `/rest/v1/${table}?${queryParams.toString()}`;

      // Create proxy event for this stat query
      const proxyEvent = {
        ...event,
        rawPath: `/rest/v1/${table}`,
        rawQueryString: queryParams.toString(),
        headers: event.headers, // Include original headers for authorization
        requestContext: {
          ...event.requestContext,
          http: {
            ...event.requestContext?.http,
            method: 'GET'
          }
        },
        httpMethod: 'GET',
        body: null
      };

      const result = await proxyToSupabase(proxyEvent, user, requestId);
      const responseData = result.body ? JSON.parse(result.body) : [];
      results[statName] = responseData[0]?.count || 0;
    }

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(origin),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(results)
    };

  } catch (error) {
    logger.error('Stats proxy error', {
      requestId,
      error: error.message,
      table
    });

    return {
      statusCode: 500,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: 'Stats query failed',
        requestId
      })
    };
  }
}

/**
 * Handle update proxy - converts request body to Supabase PATCH request
 */
async function handleUpdateProxy(requestData, user, requestId, origin, event) {
  const { table, filters, data } = requestData;

  if (!table || !filters || !data) {
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        error: 'Bad Request',
        message: 'Table, filters, and data are required',
        requestId
      })
    };
  }

  // Validate table name
  const { validateTableName, validateQueryInput, sanitizeValue } = require('./utils/sqlProtection');
  const tableValidation = validateTableName(table);
  if (!tableValidation.valid) {
    logger.warn('Invalid table name in update', {
      requestId,
      table,
      reason: tableValidation.reason
    });
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        error: 'Bad Request',
        message: tableValidation.reason,
        requestId
      })
    };
  }

  // RBAC Permission Check
  const rbacResult = await checkUserPermission(user, 'table', table, 'UPDATE', requestId);
  if (!rbacResult.allowed) {
    logger.security('RBAC permission denied for UPDATE', {
      requestId,
      userId: user.sub,
      email: user.email,
      table,
      role: rbacResult.role,
      reason: rbacResult.message
    });
    return createRBACDeniedResponse(rbacResult, requestId, origin);
  }

  // Validate filters
  const filtersValidation = validateQueryInput({ filters });
  if (!filtersValidation.valid) {
    logger.warn('Invalid filters in update', {
      requestId,
      reason: filtersValidation.reason
    });
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        error: 'Bad Request',
        message: filtersValidation.reason,
        requestId
      })
    };
  }

  try {
    // Build query parameters for filters
    const queryParams = new URLSearchParams();
    for (const [field, condition] of Object.entries(filters)) {
      const [operator, value] = Object.entries(condition)[0];
      const sanitizedValue = sanitizeValue(value);
      queryParams.append(field, `${operator}.${sanitizedValue}`);
    }

    // Create proxy event for the update
    const proxyEvent = {
      ...event,
      rawPath: `/rest/v1/${table}`,
      rawQueryString: queryParams.toString(),
      headers: event.headers, // Include original headers for authorization
      requestContext: {
        ...event.requestContext,
        http: {
          ...event.requestContext?.http,
          method: 'PATCH'
        }
      },
      httpMethod: 'PATCH',
      body: JSON.stringify(data),
      isBase64Encoded: false
    };

    const result = await proxyToSupabase(proxyEvent, user, requestId);

    // Ensure CORS headers are properly set for the response
    return {
      statusCode: result.statusCode,
      headers: mergeCorsHeaders(result.headers, corsHeaders(origin), {
        'Content-Type': 'application/json'
      }),
      body: result.body
    };

  } catch (error) {
    logger.error('Update proxy error', {
      requestId,
      error: error.message,
      table
    });

    return {
      statusCode: 500,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: 'Update failed',
        requestId
      })
    };
  }
}

/**
 * Handle delete proxy - converts request body to Supabase DELETE request
 */
async function handleDeleteProxy(requestData, user, requestId, origin, event) {
  const { table, filters } = requestData;

  if (!table || !filters) {
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        error: 'Bad Request',
        message: 'Table and filters are required',
        requestId
      })
    };
  }

  // Validate table name
  const { validateTableName, validateQueryInput, sanitizeValue } = require('./utils/sqlProtection');
  const tableValidation = validateTableName(table);
  if (!tableValidation.valid) {
    logger.warn('Invalid table name in delete', {
      requestId,
      table,
      reason: tableValidation.reason
    });
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        error: 'Bad Request',
        message: tableValidation.reason,
        requestId
      })
    };
  }

  // RBAC Permission Check
  const rbacResult = await checkUserPermission(user, 'table', table, 'DELETE', requestId);
  if (!rbacResult.allowed) {
    logger.security('RBAC permission denied for DELETE', {
      requestId,
      userId: user.sub,
      email: user.email,
      table,
      role: rbacResult.role,
      reason: rbacResult.message
    });
    return createRBACDeniedResponse(rbacResult, requestId, origin);
  }

  // Validate filters
  const filtersValidation = validateQueryInput({ filters });
  if (!filtersValidation.valid) {
    logger.warn('Invalid filters in delete', {
      requestId,
      reason: filtersValidation.reason
    });
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        error: 'Bad Request',
        message: filtersValidation.reason,
        requestId
      })
    };
  }

  try {
    // Build query parameters for filters
    const queryParams = new URLSearchParams();
    for (const [field, condition] of Object.entries(filters)) {
      const [operator, value] = Object.entries(condition)[0];
      const sanitizedValue = sanitizeValue(value);
      queryParams.append(field, `${operator}.${sanitizedValue}`);
    }

    // Create proxy event for the delete
    const proxyEvent = {
      ...event,
      rawPath: `/rest/v1/${table}`,
      rawQueryString: queryParams.toString(),
      headers: event.headers, // Include original headers for authorization
      requestContext: {
        ...event.requestContext,
        http: {
          ...event.requestContext?.http,
          method: 'DELETE'
        }
      },
      httpMethod: 'DELETE',
      body: null
    };

    const result = await proxyToSupabase(proxyEvent, user, requestId);

    // Ensure CORS headers are properly set for the response
    return {
      statusCode: result.statusCode,
      headers: mergeCorsHeaders(result.headers, corsHeaders(origin), {
        'Content-Type': 'application/json'
      }),
      body: result.body
    };

  } catch (error) {
    logger.error('Delete proxy error', {
      requestId,
      error: error.message,
      table
    });

    return {
      statusCode: 500,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: 'Delete failed',
        requestId
      })
    };
  }
}

/**
 * Handle insert proxy - converts request body to Supabase POST request
 */
async function handleInsertProxy(requestData, user, requestId, origin, event) {
  const { table, data } = requestData;

  if (!table || !data) {
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        error: 'Bad Request',
        message: 'Table and data are required',
        requestId
      })
    };
  }

  // Validate table name
  const { validateTableName } = require('./utils/sqlProtection');
  const tableValidation = validateTableName(table);
  if (!tableValidation.valid) {
    logger.warn('Invalid table name in insert', {
      requestId,
      table,
      reason: tableValidation.reason
    });
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        error: 'Bad Request',
        message: tableValidation.reason,
        requestId
      })
    };
  }

  // RBAC Permission Check
  const rbacResult = await checkUserPermission(user, 'table', table, 'INSERT', requestId);
  if (!rbacResult.allowed) {
    logger.security('RBAC permission denied for INSERT', {
      requestId,
      userId: user.sub,
      email: user.email,
      table,
      role: rbacResult.role,
      reason: rbacResult.message
    });
    return createRBACDeniedResponse(rbacResult, requestId, origin);
  }

  logger.info('Insert proxy called', {
    requestId,
    table,
    dataKeys: Object.keys(data),
    userId: user.sub
  });

  try {
    // Create proxy event for the insert
    const proxyEvent = {
      ...event,
      rawPath: `/rest/v1/${table}`,
      rawQueryString: '',
      headers: event.headers, // Include original headers for authorization
      requestContext: {
        ...event.requestContext,
        http: {
          ...event.requestContext?.http,
          method: 'POST'
        }
      },
      httpMethod: 'POST',
      body: JSON.stringify(data),
      isBase64Encoded: false
    };

    const result = await proxyToSupabase(proxyEvent, user, requestId);

    logger.info('Insert proxy response', {
      requestId,
      statusCode: result.statusCode,
      table,
      userId: user.sub
    });

    // Ensure CORS headers are properly set for the response
    return {
      statusCode: result.statusCode,
      headers: mergeCorsHeaders(result.headers, corsHeaders(origin), {
        'Content-Type': 'application/json'
      }),
      body: result.body
    };

  } catch (error) {
    logger.error('Insert proxy error', {
      requestId,
      error: error.message,
      stack: error.stack,
      table
    });

    return {
      statusCode: 500,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: 'Insert failed',
        requestId
      })
    };
  }
}

/**
 * Handle health check proxy
 */
async function handleHealthProxy(user, requestId, origin) {
  return {
    statusCode: 200,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      user: user.sub,
      requestId
    })
  };
}

/**
 * Proxy request to Supabase
 */
async function proxyToSupabase(event, user, requestId) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  logger.info('proxyToSupabase called', {
    requestId,
    userId: user.sub,
    supabaseUrl: supabaseUrl ? `${supabaseUrl.substring(0, 30)}...` : 'Not set',
    hasServiceKey: !!serviceRoleKey,
    eventPath: event.rawPath || event.path,
    eventQuery: event.rawQueryString
  });

  // Construct target URL
  // For Lambda Function URL, use rawPath directly (no stage to remove)
  const targetPath = event.rawPath || event.path;
  const queryString = event.rawQueryString
    ? '?' + event.rawQueryString
    : event.queryStringParameters
      ? '?' + new URLSearchParams(event.queryStringParameters).toString()
      : '';
  const targetUrl = `${supabaseUrl}${targetPath}${queryString}`;

  logger.info('Constructed Supabase URL', {
    requestId,
    targetPath,
    queryString,
    fullUrl: targetUrl
  });

  // Prepare headers
  const headers = {
    'Authorization': `Bearer ${serviceRoleKey}`,
    'apikey': serviceRoleKey, // Supabase also expects this header
    'Content-Type': event.headers?.['Content-Type'] || 'application/json',
    'User-Agent': 'SupabaseProxy/1.0',
    'X-Forwarded-For': event.requestContext?.identity?.sourceIp || event.requestContext?.http?.sourceIp,
    'X-Proxy-User-ID': user.sub,
    'X-Proxy-User-Email': user.email || '',
    'X-Request-ID': requestId
  };

  // Add additional headers if present
  const passThroughHeaders = [
    'Accept',
    'Accept-Language',
    'Accept-Encoding',
    'Cache-Control',
    'Prefer'
  ];

  passThroughHeaders.forEach(header => {
    if (event.headers?.[header]) {
      headers[header] = event.headers[header];
    }
  });

  const httpMethod = event.requestContext?.http?.method || event.httpMethod;
  const requestOptions = {
    method: httpMethod,
    headers,
    timeout: 30000 // 30 second timeout
  };

  // Add body for non-GET requests
  if (event.body && !['GET', 'HEAD', 'OPTIONS'].includes(httpMethod)) {
    requestOptions.body = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString()
      : event.body;
  }

  logger.info('Supabase request details', {
    requestId,
    method: httpMethod,
    hasBody: !!requestOptions.body,
    bodyLength: requestOptions.body ? requestOptions.body.length : 0,
    headerKeys: Object.keys(headers),
    hasAuth: headers.Authorization ? 'Bearer [REDACTED]' : 'Missing',
    contentType: headers['Content-Type']
  });

  try {
    logger.debug('Making fetch request to Supabase', {
      requestId,
      url: targetUrl,
      method: httpMethod
    });

    const response = await fetch(targetUrl, requestOptions);
    const responseBody = await response.text();

    logger.info('Supabase raw response', {
      requestId,
      statusCode: response.status,
      statusText: response.statusText,
      bodyLength: responseBody.length,
      bodyPreview: responseBody.substring(0, 200) + (responseBody.length > 200 ? '...' : ''),
      responseHeaders: Object.fromEntries(response.headers.entries())
    });

    // Extract relevant response headers
    const responseHeaders = {};
    const headersToCopy = [
      'content-type',
      'content-length',
      'cache-control',
      'etag',
      'last-modified',
      'location'
    ];

    headersToCopy.forEach(header => {
      const value = response.headers.get(header);
      if (value) {
        responseHeaders[header] = value;
      }
    });

    // Log any errors in the response
    if (response.status >= 400) {
      logger.error('Supabase returned error response', {
        requestId,
        statusCode: response.status,
        statusText: response.statusText,
        responseBody,
        requestUrl: targetUrl,
        requestMethod: httpMethod
      });
    }

    return {
      statusCode: response.status,
      headers: responseHeaders,
      body: responseBody
    };

  } catch (error) {
    logger.error('Supabase proxy network error', {
      requestId,
      error: error.message,
      stack: error.stack,
      targetUrl,
      method: httpMethod,
      userId: user.sub,
      hasInternet: true // Could add connectivity check here
    });

    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Bad Gateway',
        message: 'Failed to connect to Supabase',
        requestId
      })
    };
  }
}

/**
 * Merge headers while avoiding duplicate CORS headers
 * Prioritizes CORS headers from corsHeaders over existing headers
 */
function mergeCorsHeaders(existingHeaders = {}, corsHeaders = {}, additionalHeaders = {}) {
  const merged = { ...existingHeaders };

  // Remove any existing CORS headers to prevent duplicates
  const corsHeaderNames = [
    'access-control-allow-origin',
    'access-control-allow-methods',
    'access-control-allow-headers',
    'access-control-allow-credentials',
    'access-control-expose-headers',
    'access-control-max-age'
  ];

  corsHeaderNames.forEach(header => {
    // Remove both lowercase and other case variations
    Object.keys(merged).forEach(key => {
      if (key.toLowerCase() === header) {
        delete merged[key];
      }
    });
  });

  // Add the fresh CORS headers
  Object.assign(merged, corsHeaders);

  // Add any additional headers
  Object.assign(merged, additionalHeaders);

  return merged;
}