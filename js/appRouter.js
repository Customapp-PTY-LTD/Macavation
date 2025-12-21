var _appRouter = function () {
    return {
        version: '2.01',
        routeConfigPath: './js/appRouteConfig.json',
        baseScripts: ['js/data-functions.js', 'js/farm-selector-utils.js'],
        //--Set in the appRouteConfig.json
        SupabaseUrl: "",
        LambdaProxyUrl: "",
        //-----------------------

        breadCrumbs: [],
        routeParams: {},
        currentRoute: null,
        //------------
        init: async () => {


            const breadCrumbs = sessionStorage.getItem('breadCrumbs');
            if (breadCrumbs) {
                try {
                    _appRouter.breadCrumbs = JSON.parse(breadCrumbs);
                }
                catch (e) { }
            }

            const routeParams = sessionStorage.getItem('routeParams');
            if (routeParams) {
                try {
                    _appRouter.routeParams = JSON.parse(routeParams);
                }
                catch (e) { }
            }

            //bind nav event
            await _appRouter.loadRouteConfig();

            // Check localStorage first (persists across sessions), then sessionStorage, then default
            var activePage = localStorage.getItem('lastActivePage') || 
                           sessionStorage.getItem('lastActivePage') || 
                           '';

            // Check for URL parameter that might override
            if (typeof _common !== 'undefined' && _common.getUrlParams && _common.getUrlParams().ar) {
                activePage = '';
            }
            
            // If still no active page, use default route
            if (!activePage) {
                activePage = _appRouter.defaultRoute;
            }
            
            // Store in sessionStorage for current session
            if (activePage) {
                sessionStorage.setItem('lastActivePage', activePage);
            }
            const loadContent_result = await _appRouter.loadContent({
                routeName: activePage,
                elementSelector: _appRouter.contentContainer
            });
            if (!loadContent_result.success) {
                console.error('failed to load content', loadContent_result.errors)
            }

            // Bind navigation events for all nav links with route attribute
            $(document).on('click', 'a[route]', async (e) => {
                e.preventDefault();

                const routeName = $(e.currentTarget).attr('route');

                if (routeName) {
                    console.log('Navigation clicked:', routeName);

                    // Update active nav link
                    $('a[route]').removeClass('active');
                    $(e.currentTarget).addClass('active');

                    await _appRouter.promptOnFormExit(routeName);
                    $(window).scrollTop(0);
                }
            });

        },
        loadRouteConfig: () => {

            return fetch(_appRouter.routeConfigPath)
                .then(response => {
                    if (!response.ok) {
                        throw new Error('error fetching config: ' + response.status);
                    }
                    return response.json();
                })
                .then(data => {
                    _appRouter.basePath = data.basePath;
                    _appRouter.defaultRoute = data.defaultRoute;
                    _appRouter.contentContainer = data.contentContainer;
                    _appRouter.routeConfig = data.appRoutes;


                    //console.log(_appRouter.routeConfig);
                    //get environment

                    const environment = _appRouter.getEnvironment();

                    if (data.environmentSettings) {
                        let environmentSetting = data.environmentSettings[environment];
                        if (!environmentSetting || !Object.keys(environmentSetting || {}).length) {
                            environmentSetting = data.environmentSettings.default;
                        }

                        if (!environmentSetting) {
                            console.error(`no environment setting configured for ${environment} found in appRouteConfig`);
                            return;
                        }

                        _appRouter.env = environmentSetting;

                        _appRouter.SupabaseUrl = environmentSetting.SupabaseUrl;
                        _appRouter.LambdaProxyUrl = environmentSetting.LambdaProxyUrl;
                        // _appRouter.routeConfig = _appRouter.loadRoleConfig(data.appRoutes);

                    }

                })
                .catch(error => {
                    console.error('There was a problem fetching the config:', error);
                });
        },
        loadContent: async ({ routeName, elementSelector }) => {

            console.info("appRouter.loadContent", routeName);

            // Check authentication for all routes
            if (typeof dataFunctions !== 'undefined') {
                const isAuthenticated = dataFunctions.isAuthenticated() ||
                                       (typeof authService !== 'undefined' && authService.isAuthenticated());
                
                if (!isAuthenticated) {
                    // Get cc parameter from localStorage or URL
                    const ccParam = localStorage.getItem('client_guid') || 
                                   new URLSearchParams(window.location.search).get('cc') ||
                                   '9e1d961a-bfc2-469d-8526-8af75f536656';
                    
                    // Redirect to signin with cc parameter
                    const signinUrl = `signin.html?cc=${encodeURIComponent(ccParam)}`;
                    window.location.href = signinUrl;
                    return { success: false, errors: ['Authentication required'] };
                }

                // Check if this is a user management module
                const userManagementModules = ['users-grid', 'roles-grid', 'role-permissions-grid', 'role-features-grid'];

                if (userManagementModules.includes(routeName)) {

                    if (!dataFunctions.canAccessUserManagement()) {
                        console.log('Insufficient permissions, redirecting to dashboard...');
                        // Show permission error
                        const contentArea = document.getElementById('content-area');
                        if (contentArea) {
                            contentArea.innerHTML = `
                                <div class="alert alert-warning" role="alert">
                                    <h4 class="alert-heading"><i class="fas fa-exclamation-triangle me-2"></i>Access Denied</h4>
                                    <p>You need admin or manager role to access user management.</p>
                                    <hr>
                                    <p class="mb-0">Redirecting to users grid...</p>
                                </div>
                            `;
                            setTimeout(() => {
                                _appRouter.routeTo('users-grid');
                            }, 3000);
                        }
                        return { success: false, errors: ['Insufficient permissions'] };
                    }
                }
            }

            //load content into elementSelector

            let result = {
                success: false,
                errors: []
            };

            const route = _appRouter.routeConfig[routeName];

            if (!route) {
                //alert error 404
                result.success = false;
                result.errors.push('no route config found for ' + routeName);
                return result;
            }

            const { path, html, js, css } = route;

            const resoucePath = `${_appRouter.basePath}/${path}`;

            //load css
            const loadCSS_result = await _appRouter.loadCSS(css, resoucePath);
            if (loadCSS_result.errors.length) {
                result.success = false;
                result.errors = result.errors.concat(loadCSS_result.errors);
            }

            const fetchHtml_result = await _appRouter.fetchHtml(`${resoucePath}/${html}`);

            if (!fetchHtml_result.success) {
                //raise error
                result.success = false;
                result.errors.push(`no html found ${routeName}: ${resoucePath}/${html}`);
                return result
            }

            let content = fetchHtml_result.data;

            content = content.replace(/{basePath}/g, resoucePath);

            $(elementSelector).html(content);

            //load js
            const loadJSCode_result = await _appRouter.loadJSCode(js, resoucePath);
            if (loadJSCode_result.errors.length) {
                console.error('failed to load the following js files', loadJSCode_result.errors);
                //raise error
                result.success = false;
                result.errors = result.errors.concat(loadJSCode_result.errors);
            }

            // Set success to true if no errors occurred
            if (result.errors.length === 0) {
                result.success = true;
            }

            // Initialize module after loading with a small delay to ensure scripts are executed
            setTimeout(() => {
                _appRouter.initializeModule(routeName);
            }, 100);

            return result;
        },
        initializeModule: (routeName) => {
            console.log('Initializing module:', routeName);

            // Map route names to module initialization functions
            const moduleInitializers = {
                'dashboard': () => {
                    if (typeof initializeDashboard === 'function') {
                        initializeDashboard();
                    }
                },
                'labour-grid': () => {
                    if (typeof initializeLabourGrid === 'function') {
                        initializeLabourGrid();
                    }
                },
                'users-grid': () => {
                    if (typeof initializeUsersGrid === 'function') {
                        initializeUsersGrid();
                    }
                },
                'roles-grid': () => {
                    if (typeof initializeRolesGrid === 'function') {
                        initializeRolesGrid();
                    }
                },
                'role-permissions-grid': () => {
                    if (typeof initializeRolePermissionsGrid === 'function') {
                        initializeRolePermissionsGrid();
                    }
                },
                'compliance-grid': () => {
                    if (typeof initializeComplianceGrid === 'function') {
                        initializeComplianceGrid();
                    }
                },
                'chemicals-grid': () => {
                    if (typeof initializeChemicalsGrid === 'function') {
                        initializeChemicalsGrid();
                    }
                },
                'crops-grid': () => {
                    if (typeof initializeCropsGrid === 'function') {
                        initializeCropsGrid();
                    }
                },
                'assets-grid': () => {
                    if (typeof initializeAssetsGrid === 'function') {
                        initializeAssetsGrid();
                    }
                },
                'postharvest-grid': () => {
                    if (typeof initializePostharvestGrid === 'function') {
                        initializePostharvestGrid();
                    }
                },
                'water-grid': () => {
                    if (typeof initializeWaterGrid === 'function') {
                        initializeWaterGrid();
                    }
                },
                'admin-grid': () => {
                    if (typeof initializeAdminGrid === 'function') {
                        initializeAdminGrid();
                    }
                },
                'role-features-grid': () => {
                    if (typeof initializeRoleFeaturesGrid === 'function') {
                        initializeRoleFeaturesGrid();
                    }
                },
                'companies-grid': () => {
                    if (typeof initializeCompaniesGrid === 'function') {
                        initializeCompaniesGrid();
                    }
                },
                'drivers-grid': () => {
                    if (typeof initializeDriversGrid === 'function') {
                        initializeDriversGrid();
                    }
                },
                'vehicles-grid': () => {
                    if (typeof initializeVehiclesGrid === 'function') {
                        initializeVehiclesGrid();
                    }
                },
                'inspections-grid': () => {
                    if (typeof initializeInspectionsGrid === 'function') {
                        initializeInspectionsGrid();
                    }
                },
                'inspection-form': () => {
                    if (typeof initializeInspectionForm === 'function') {
                        initializeInspectionForm();
                    }
                }
            };

            const initializer = moduleInitializers[routeName];
            if (initializer) {
                try {
                    initializer();
                    console.log(`Module ${routeName} initialized successfully`);
                } catch (error) {
                    console.error(`Error initializing module ${routeName}:`, error);
                }
            } else {
                console.warn(`No initializer found for module: ${routeName}`);
            }
        },
        loadWebformFromUrl: (url, elementSelector) => {
            jQuery(elementSelector).find('iframe').attr('src', url);
        },
        injectFormHtml: async (url, element, Id_Class_Flag) => {
            //   0 for Class and 1 for Id, this is the indicator for Id_Class_Flag
            //   element variable is the class name or the id for the element to inject html into
            let result = {
                success: false,
                errors: []
            };

            if (Id_Class_Flag != 0 && Id_Class_Flag != 1) {
                result.errors.push(`Incorrect flag value: must be 0 or 1`);
                console.error(result.errors[0]);
                return result;
            }

            var html = await _appRouter.fetchHtml(url);

            if (!html.success) {
                // Raise error
                result.errors.push(`No HTML found at: ${url}`);
                console.error(result.errors[0]);
                return result;
            }

            var elementTarget;

            if (Id_Class_Flag == 0) {
                elementTarget = jQuery('.' + element); // Changed from $ to jQuery
            }
            else {
                elementTarget = jQuery('#' + element); // Changed from $ to jQuery
            }

            if (elementTarget.length > 0) {
                elementTarget.html(html.data);
                elementTarget.css({
                    'text-align': 'center',
                    'padding': '10px'
                });
                result.success = true;
            }
            else {
                // Raise error
                var errorMessage = '';

                if (Id_Class_Flag == 0) {
                    errorMessage = `Cannot find element with ${element} class`;
                }
                else {
                    errorMessage = `Cannot find element with id ${element}`;
                }
                result.errors.push(errorMessage);
                console.error(result.errors[0]);
                return result;
            }

            return result;
        },
        routeTo: (routeName, addBreadCrumb, params) => {
            // Store in both sessionStorage (current session) and localStorage (persist across sessions)
            sessionStorage.setItem('lastActivePage', routeName);
            localStorage.setItem('lastActivePage', routeName);
            _appRouter.currentRoute = routeName;
            
            _appRouter.loadContent({
                routeName: routeName,
                elementSelector: _appRouter.contentContainer
            }).then(() => {
                $(window).scrollTop(0);
            });
            if (addBreadCrumb === true && routeName) {
                _appRouter.addBreadCrumb({
                    routeName,
                    params
                });
            }

        },
        promptOnFormExit: async (routeName) => {
            const jotFormIframes = ['#quote-frame', '#appointment-frame', '#ownrecord-frame', '#record-frame', '#proposal-frame', '#uploadinformation-frame'];

            var isIframeVisible = jotFormIframes.some(id => $(id).is(':visible'));

            if (isIframeVisible) {
                const result = await Swal.fire({
                    title: 'Are you sure?',
                    text: 'Would you like to save and exit the form?',
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Yes',
                    cancelButtonText: 'No',
                    confirmButtonColor: '#3085d6',
                    cancelButtonColor: '#d33',
                    backdrop: 'rgb(245 247 250 / 40%)',
                });

                if (result.isConfirmed) {
                    sessionStorage.setItem('lastActivePage', routeName);
                    await _appRouter.loadContent({
                        routeName: routeName,
                        elementSelector: _appRouter.contentContainer
                    });
                }
            }
            else {
                // If no form or iframe is displayed, navigate directly
                sessionStorage.setItem('lastActivePage', routeName);
                localStorage.setItem('lastActivePage', routeName);
                _appRouter.currentRoute = routeName;
                
                await _appRouter.loadContent({
                    routeName: routeName,
                    elementSelector: _appRouter.contentContainer
                });
            }
        },
        getEnvironment: () => {

            let environment = "prod";

            if (location.href.indexOf('/_static/') > -1 || location.href.indexOf('://dev') > -1) {
                environment = 'dev';
            }
            else if (location.href.indexOf('://demo') > -1) {
                environment = 'demo';
            }
            else if (location.href.indexOf('://uat') > -1) {
                environment = 'uat';
            }
            return environment;


        },
        addBreadCrumb: ({ routeName, params }) => {
            if (!routeName) {
                console.warn("cannot add breadcrumb for blank routeName")
                return;
            }

            _appRouter.routeParams[routeName] = params;

            const existingIndex = _appRouter.breadCrumbs.indexOf(routeName);

            if (existingIndex > -1) {
                _appRouter.breadCrumbs.splice(existingIndex + 1);
            }
            else {
                _appRouter.breadCrumbs.push(routeName);
            }

            sessionStorage.setItem('breadCrumbs', JSON.stringify(_appRouter.breadCrumbs));

            //update route params
            sessionStorage.setItem('routeParams', JSON.stringify(_appRouter.routeParams));

            return _appRouter.breadCrumbs;
        },
        loadPrevBreadCrumb: () => {
            if (_appRouter.breadCrumbs.length > 1) {
                _appRouter.breadCrumbs.pop();

                const previousRoute = _appRouter.breadCrumbs[_appRouter.breadCrumbs.length - 1];

                const previousParams = _appRouter.routeParams[previousRoute] || {};

                sessionStorage.setItem('breadCrumbs', JSON.stringify(_appRouter.breadCrumbs));
                sessionStorage.setItem('routeParams', JSON.stringify(_appRouter.routeParams));

                _appRouter.loadContent({
                    routeName: previousRoute,
                    elementSelector: _appRouter.contentContainer
                }).then(() => {
                    $(window).scrollTop(0);
                });
            }
            else {
                console.warn("No previous breadcrumb to go back to.");
            }
        },
        loadBreadCrumbs: (containerElement) => {

            const breadCrumbs = JSON.parse(sessionStorage.getItem('breadCrumbs'));

            const breadCrumbsHtml = breadCrumbs.map((routeName, i) => {


                const routeConfig = _appRouter.routeConfig[routeName];

                const isLast = breadCrumbs.length === (i + 1);

                let itemLabel = routeConfig.description || routeName;

                const itemParams = JSON.parse(sessionStorage.routeParams)[routeName];

                if (itemParams) {
                    for (let key in itemParams) {
                        itemLabel = itemLabel.replace(`{${key}}`, itemParams[key]);
                    }
                }

                if (isLast) {
                    return `<li class="breadcrumb-item active" aria-current="page">${itemLabel}</li>`
                }

                return `<li class="breadcrumb-item"><a data-route-name="${routeName}" href="#">${itemLabel}</a></li>`
            }).join('')

            let breadCrumbNav = `<nav aria-label="breadcrumb"><ol class="breadcrumb mb-0">${breadCrumbsHtml}</ol></nav>`;

            $(containerElement).html(breadCrumbNav);

            setTimeout(() => {
                $(containerElement).find('.breadcrumb-item a').on('click', (evt) => {


                    const routeName = $(evt.currentTarget).data().routeName;

                    _appRouter.routeTo(routeName, true, _appRouter.routeParams[routeName]);

                })
            }, 150)



            return breadCrumbNav

        },
        clearBreadCrumbs: (excludeFirstBreadCrumb) => {
            const scope = _appRouter;

            if (excludeFirstBreadCrumb) {
                const firstBreadCrumb = scope.breadCrumbs[0];
                scope.breadCrumbs = [];
                scope.breadCrumbs.push(firstBreadCrumb);
            }
            else {
                scope.breadCrumbs = [];
            }

            sessionStorage.setItem('breadCrumbs', JSON.stringify(scope.breadCrumbs));
        },
        routes: {
            source_documents: {
                contentUrl: 'modules/source_documents/html/source_documents.html',
                jsUrl: 'modules/source_documents/js/source_documents.js',
                title: 'Source Documents'
            }
        },
        loadJSCode: async (jsFiles, resourcePath) => {
            const result = { success: true, errors: [] };

            if (!jsFiles || !Array.isArray(jsFiles) || jsFiles.length === 0) {
                return result;
            }

            for (const jsFile of jsFiles) {
                try {
                    // Check if script is already loaded
                    const scriptId = `script-${jsFile.replace(/[^a-zA-Z0-9]/g, '-')}`;
                    if (document.getElementById(scriptId)) {
                        continue; // Script already loaded
                    }

                    const script = document.createElement('script');
                    script.id = scriptId;
                    script.src = `${resourcePath}/${jsFile}`;

                    // Make script loading synchronous by using a Promise
                    await new Promise((resolve, reject) => {
                        script.onload = () => {
                            console.log(`Script loaded successfully: ${jsFile}`);
                            // Add a small delay to ensure the script is fully executed
                            setTimeout(resolve, 50);
                        };
                        script.onerror = () => reject(new Error(`Failed to load script: ${jsFile}`));
                        document.head.appendChild(script);
                    });

                    console.log(`Loaded JavaScript file: ${jsFile}`);
                } catch (error) {
                    console.error(`Error loading JavaScript file ${jsFile}:`, error);
                    result.errors.push(`Error loading ${jsFile}: ${error.message}`);
                }
            }

            if (result.errors.length > 0) {
                result.success = false;
            }

            return result;
        },
        loadCSS: async (cssFiles, resourcePath) => {
            const result = { success: true, errors: [] };

            if (!cssFiles || !Array.isArray(cssFiles) || cssFiles.length === 0) {
                return result;
            }

            for (const cssFile of cssFiles) {
                try {
                    // Check if stylesheet is already loaded
                    const linkId = `link-${cssFile.replace(/[^a-zA-Z0-9]/g, '-')}`;
                    if (document.getElementById(linkId)) {
                        continue; // Stylesheet already loaded
                    }

                    const link = document.createElement('link');
                    link.id = linkId;
                    link.rel = 'stylesheet';
                    link.type = 'text/css';
                    link.href = `${resourcePath}/${cssFile}`;

                    // Make CSS loading synchronous by using a Promise
                    await new Promise((resolve, reject) => {
                        link.onload = resolve;
                        link.onerror = () => reject(new Error(`Failed to load stylesheet: ${cssFile}`));
                        document.head.appendChild(link);
                    });

                    console.log(`Loaded CSS file: ${cssFile}`);
                } catch (error) {
                    console.error(`Error loading CSS file ${cssFile}:`, error);
                    result.errors.push(`Error loading ${cssFile}: ${error.message}`);
                }
            }

            if (result.errors.length > 0) {
                result.success = false;
            }

            return result;
        },
        fetchHtml: async (htmlPath) => {
            const result = { success: false, data: null, errors: [] };

            try {
                const response = await fetch(htmlPath);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const html = await response.text();
                result.success = true;
                result.data = html;
            } catch (error) {
                console.error(`Error fetching HTML from ${htmlPath}:`, error);
                result.errors.push(`Error fetching HTML: ${error.message}`);
            }

            return result;
        },
        loadRouteConfig: () => {
            return fetch(_appRouter.routeConfigPath)
                .then(response => {
                    if (!response.ok) {
                        throw new Error('error fetching config: ' + response.status);
                    }
                    return response.json();
                })
                .then(data => {
                    _appRouter.basePath = data.basePath;
                    _appRouter.defaultRoute = data.defaultRoute;
                    _appRouter.contentContainer = data.contentContainer;
                    _appRouter.routeConfig = data.appRoutes;
                    const environment = _appRouter.getEnvironment();
                    if (data.environmentSettings) {
                        let environmentSetting = data.environmentSettings[environment];
                        if (!environmentSetting || !Object.keys(environmentSetting || {}).length) {
                            environmentSetting = data.environmentSettings.default;
                        }
                        if (!environmentSetting) {
                            console.error(`no environment setting configured for ${environment} found in appRouteConfig`);
                            return;
                        }
                        _appRouter.env = environmentSetting;
                        _appRouter.SupabaseUrl = environmentSetting.SupabaseUrl;
                        _appRouter.LambdaProxyUrl = environmentSetting.LambdaProxyUrl;
                    }
                })
                .catch(error => {
                    console.error('There was a problem fetching the config:', error);
                });
        },
        routeConfig: {
            source_documents: {
                path: "modules/source_documents",
                html: "html/source_documents.html",
                js: ["js/source_documents.js"],
                css: [],
                description: "Source Documents"
            },
        }
    }
}();
