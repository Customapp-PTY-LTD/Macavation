import { Page } from '@playwright/test';

/**
 * API Helper for making calls to the Lambda proxy
 */

const LAMBDA_URL = process.env.LAMBDA_PROXY_URL || 
  'https://rzrx6ntfejvb6lxpmt4ywruvt40mjjuo.lambda-url.af-south-1.on.aws';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Get auth token from page's localStorage
 */
export async function getAuthToken(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    return localStorage.getItem('jwt_token') || localStorage.getItem('authToken');
  });
}

/**
 * Call a database function via the Lambda proxy
 */
export async function callFunction<T = any>(
  functionName: string,
  params: Record<string, any> = {},
  token?: string
): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${LAMBDA_URL}/proxy/function`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        function_name: functionName,
        params,
      }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      return {
        success: false,
        error: data.error || `HTTP ${response.status}`,
      };
    }

    return {
      success: true,
      data: data.result || data,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Login via API and get token
 */
export async function loginViaApi(
  email: string,
  password: string
): Promise<ApiResponse<{ token: string; user: any }>> {
  try {
    const response = await fetch(`${LAMBDA_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      return {
        success: false,
        error: data.error || 'Login failed',
      };
    }

    return {
      success: true,
      data,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Create test data via API
 */
export async function createTestData<T = any>(
  tableName: string,
  data: Record<string, any>,
  token: string
): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${LAMBDA_URL}/proxy/insert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        table: tableName,
        data,
      }),
    });

    const result = await response.json();
    
    if (!response.ok) {
      return {
        success: false,
        error: result.error || 'Insert failed',
      };
    }

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Delete test data via API
 */
export async function deleteTestData(
  tableName: string,
  id: string,
  token: string
): Promise<ApiResponse> {
  try {
    const response = await fetch(`${LAMBDA_URL}/proxy/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        table: tableName,
        match: { id },
      }),
    });

    const result = await response.json();
    
    if (!response.ok) {
      return {
        success: false,
        error: result.error || 'Delete failed',
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
