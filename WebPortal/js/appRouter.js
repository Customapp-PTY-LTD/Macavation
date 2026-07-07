var _appRouter = function () {
    return {
        version: '2.01',
        routeConfigPath: './js/appRouteConfig.json',
        baseScripts: ['js/data-functions.js'],
        //--Set in the appRouteConfig.json
        SupabaseUrl: "",
        SupabaseAnonKey: "",
        LambdaProxyUrl: "",
        _configPromise: null,
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
            await _appRouter.ensureConfigured();

            // Check localStorage first (persists across sessions), then sessionStorage, then default
            var activePage = Session.get('lastActivePage') ||
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
        // appRouter is the single source of truth for environment + database config.
        // Memoized so appRouteConfig.json is loaded exactly once; safe to await from anywhere
        // (e.g. dataFunctions before a DB call). On failure it rejects loudly rather than
        // letting callers fall back to a hardcoded/global database.
        ensureConfigured: () => {
            if (!_appRouter._configPromise) {
                _appRouter._configPromise = _appRouter.loadRouteConfig()
                    .then(() => {
                        if (!_appRouter.SupabaseUrl || !_appRouter.LambdaProxyUrl) {
                            throw new Error('appRouter: environment configuration missing for "' + _appRouter.getEnvironment() + '" (SupabaseUrl/LambdaProxyUrl). Check appRouteConfig.json.');
                        }
                    })
                    .catch((err) => {
                        _appRouter._configPromise = null; // allow a later call to retry
                        throw err;
                    });
            }
            return _appRouter._configPromise;
        },
        loadContent: async ({ routeName, elementSelector }) => {

            console.info("appRouter.loadContent", routeName);

            // Check authentication for all routes
            if (typeof dataFunctions !== 'undefined') {
                const isAuthenticated = dataFunctions.isAuthenticated() ||
                                       (typeof authService !== 'undefined' && authService.isAuthenticated());
                
                if (!isAuthenticated) {
                    // Get cc parameter from localStorage or URL
                    const ccParam = Session.get('clientGuid') ||
                                   new URLSearchParams(window.location.search).get('cc') ||
                                   '9e1d961a-bfc2-469d-8526-8af75f536656';
                    
                    // Redirect to signin with cc parameter
                    const signinUrl = `signin.html?cc=${encodeURIComponent(ccParam)}`;
                    window.location.href = signinUrl;
                    return { success: false, errors: ['Authentication required'] };
                }

                // Role-based menu access check only when loading into the main content area.
                // Skip when loading into a modal/other container (e.g. stock grid loading modal content) - parent route already passed.
                var isMainContent = !elementSelector || elementSelector === _appRouter.contentContainer ||
                    (elementSelector.indexOf('content-area') !== -1);
                if (isMainContent && typeof roleMenuConfig !== 'undefined' && roleMenuConfig.getUserRole()) {
                    let hasAccess = roleMenuConfig.hasAccess(routeName);
                    // If hasAccess says no, allow when: (1) sidebar link is visible, or (2) route is in getAccessibleMenus()
                    if (!hasAccess) {
                        const navItem = document.querySelector('#sidebarMenu .nav-item[data-route="' + routeName + '"]');
                        const link = document.querySelector('#sidebarMenu a[route="' + routeName + '"]');
                        const item = navItem || (link ? link.closest('.nav-item') : null);
                        if (item && !item.classList.contains('d-none')) {
                            hasAccess = true;
                        }
                        if (!hasAccess && roleMenuConfig.getAccessibleMenus && roleMenuConfig.getAccessibleMenus().indexOf(routeName) !== -1) {
                            hasAccess = true;
                        }
                    }
                    if (!hasAccess) {
                        console.log(`[App Router] Access denied for route: ${routeName}`);
                        const contentArea = document.getElementById('content-area');
                        if (contentArea) {
                            contentArea.innerHTML = `
                                <div class="alert alert-warning" role="alert">
                                    <h4 class="alert-heading"><i class="fas fa-exclamation-triangle me-2"></i>Access Denied</h4>
                                    <p>You do not have permission to access this module.</p>
                                    <hr>
                                    <p class="mb-0">Redirecting to dashboard...</p>
                                </div>
                            `;
                            setTimeout(() => {
                                _appRouter.routeTo('dashboard');
                            }, 2000);
                        }
                        return { success: false, errors: ['Insufficient permissions'] };
                    }
                }

                // Check if this is a user management module
                const userManagementModules = ['users-grid', 'roles-grid', 'role-permissions-grid', 'role-features-grid', 'features-grid'];

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
                                    <p class="mb-0">Redirecting to dashboard...</p>
                                </div>
                            `;
                            setTimeout(() => {
                                _appRouter.routeTo('dashboard');
                            }, 3000);
                        }
                        return { success: false, errors: ['Insufficient permissions'] };
                    }
                }

                // Check if this is a test management module (test scenarios and test data)
                const testManagementModules = ['test-scenarios-grid', 'test-data-grid'];

                if (testManagementModules.includes(routeName)) {
                    if (!dataFunctions.canAccessTestManagement()) {
                        console.log('Insufficient permissions for test management, redirecting to dashboard...');
                        // Show permission error
                        const contentArea = document.getElementById('content-area');
                        if (contentArea) {
                            contentArea.innerHTML = `
                                <div class="alert alert-danger" role="alert">
                                    <h4 class="alert-heading"><i class="fas fa-exclamation-triangle me-2"></i>Access Denied</h4>
                                    <p>You need Super Admin role to access test management modules.</p>
                                    <hr>
                                    <p class="mb-0">Redirecting to dashboard...</p>
                                </div>
                            `;
                            setTimeout(() => {
                                _appRouter.routeTo('dashboard');
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

            // Safety: if a modal/backdrop got stuck on the previous screen, clear it before rendering new content
            if (window._common && typeof window._common.forceCloseAllModals === 'function') {
                window._common.forceCloseAllModals();
            }

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
            if (result.success && elementSelector === _appRouter.contentContainer) {
                _appRouter.currentRoute = routeName;
            }

            // Initialize module after loading with a small delay to ensure scripts are executed
            setTimeout(() => {
                _appRouter.initializeModule(routeName);
                if (typeof actionAccess !== 'undefined' && actionAccess.apply) {
                    var root = document.getElementById('content-area') || document.querySelector(elementSelector);
                    if (root) actionAccess.apply(root);
                }
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
                'my-day': () => {
                    if (typeof initializeMyDay === 'function') {
                        initializeMyDay();
                    }
                },
                'users-grid': () => {
                    if (typeof initializeUsersGrid === 'function') {
                        initializeUsersGrid();
                    }
                },
                'user-modal': () => {
                    if (typeof _modal_user !== 'undefined' && _modal_user.init) {
                        _modal_user.init();
                    }
                },
                'roles-grid': () => {
                    if (typeof initializeRolesGrid === 'function') {
                        initializeRolesGrid();
                    }
                },
                'role-modal': () => {
                    if (typeof _modal_role !== 'undefined' && _modal_role.init) {
                        _modal_role.init();
                    }
                },
                'test-scenarios-grid': () => {
                    if (typeof testScenariosGrid !== 'undefined' && typeof testScenariosGrid.init === 'function') {
                        testScenariosGrid.init();
                    }
                },
                'test-scenario-modal': () => {
                    if (typeof _modal_test_scenario !== 'undefined' && _modal_test_scenario.init) _modal_test_scenario.init();
                },
                'test-data-grid': () => {
                    if (typeof testDataGrid !== 'undefined' && typeof testDataGrid.init === 'function') {
                        testDataGrid.init();
                    }
                },
                'test-data-set-modal': () => {
                    if (typeof _modal_test_data_set !== 'undefined' && _modal_test_data_set.init) _modal_test_data_set.init();
                },
                'test-data-record-modal': () => {
                    if (typeof _modal_test_data_record !== 'undefined' && _modal_test_data_record.init) _modal_test_data_record.init();
                },
                'role-permissions-grid': () => {
                    if (typeof initializeRolePermissionsGrid === 'function') {
                        initializeRolePermissionsGrid();
                    }
                },
                'role-permission-modal': () => {
                    if (typeof _modal_role_permission !== 'undefined' && _modal_role_permission.init) {
                        _modal_role_permission.init();
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
                'role-feature-modal': () => {
                    if (typeof _modal_role_feature !== 'undefined' && _modal_role_feature.init) {
                        _modal_role_feature.init();
                    }
                },
                'features-grid': () => {
                    if (typeof initializeFeaturesGrid === 'function') {
                        initializeFeaturesGrid();
                    }
                },
                'feature-modal': () => {
                    if (typeof _modal_feature !== 'undefined' && _modal_feature.init) {
                        _modal_feature.init();
                    }
                },
                'crm-grid': () => {
                    if (typeof initializeCrmGrid === 'function') {
                        initializeCrmGrid();
                    }
                },
                'crm-contact-modal': () => {
                    if (typeof _modal_crm_contact !== 'undefined' && _modal_crm_contact.init) {
                        _modal_crm_contact.init();
                    }
                },
                'grower-intake-grid': () => {
                    if (typeof _growerIntakeGrid !== 'undefined' && _growerIntakeGrid.init) _growerIntakeGrid.init();
                },
                'supplier-intake-grid': () => {
                    if (typeof initializeSupplierIntakeGrid === 'function') initializeSupplierIntakeGrid();
                },
                'supplier-oil-batch-modal': () => {
                    if (typeof _modalSupplierOilBatch !== 'undefined' && _modalSupplierOilBatch.init) _modalSupplierOilBatch.init();
                },
                'kernel-production-grid': () => {
                    if (typeof initializeKernelProductionGrid === 'function') {
                        initializeKernelProductionGrid();
                    }
                },
                'kernel-production-forecast-grid': () => {
                    if (typeof initializeKernelProductionForecastGrid === 'function') {
                        initializeKernelProductionForecastGrid();
                    }
                },
                'kernel-dispatch-grid': () => {
                    if (typeof _kernelDispatchGrid !== 'undefined' && _kernelDispatchGrid.init) _kernelDispatchGrid.init();
                },
                'data-import-grid': () => {
                    if (typeof initializeDataImportGrid === 'function') {
                        initializeDataImportGrid();
                    }
                },
                'quality-assurance-grid': () => {
                    if (typeof initializeQualityAssuranceGrid === 'function') {
                        initializeQualityAssuranceGrid();
                    }
                },
                'quality-test-modal': () => {
                    if (typeof _modal_quality_test !== 'undefined' && _modal_quality_test.init) {
                        _modal_quality_test.init();
                    }
                },
                'stock-management-grid': () => {
                    if (typeof initializeStockManagementGrid === 'function') {
                        initializeStockManagementGrid();
                    }
                },
                'stock-management-kernel': () => {
                    if (typeof initializeStockManagementGrid === 'function') {
                        initializeStockManagementGrid();
                    }
                },
                'stock-management-oil': () => {
                    if (typeof initializeStockManagementGrid === 'function') {
                        initializeStockManagementGrid();
                    }
                },
                'oil-lot-modal': () => {
                    if (typeof _modal_stock_oil_lot !== 'undefined' && _modal_stock_oil_lot.init) _modal_stock_oil_lot.init();
                },
                'import-oil-lots-modal': () => {
                    if (typeof _modal_stock_import_oil_lots !== 'undefined' && _modal_stock_import_oil_lots.init) _modal_stock_import_oil_lots.init();
                },
                'oil-bulk-add-stock-modal': () => {
                    if (typeof _modal_stock_oil_bulk_add !== 'undefined' && _modal_stock_oil_bulk_add.init) _modal_stock_oil_bulk_add.init();
                },
                'receiving-checklist-modal': () => {
                    if (typeof _modal_stock_receiving_checklist !== 'undefined' && _modal_stock_receiving_checklist.init) _modal_stock_receiving_checklist.init();
                },
                'supplier-receiver-checklist-modal': () => {
                    if (typeof _modal_supplier_receiver_checklist !== 'undefined' && _modal_supplier_receiver_checklist.init) _modal_supplier_receiver_checklist.init();
                },
                'supplier-intake-adjust-stock-modal': () => {
                    if (typeof initializeSupplierIntakeAdjustStockModal === 'function') {
                        initializeSupplierIntakeAdjustStockModal();
                    }
                },
                'raw-material-issued-modal': () => {
                    if (typeof _modal_stock_raw_material_issued !== 'undefined' && _modal_stock_raw_material_issued.init) _modal_stock_raw_material_issued.init();
                },
                'stock-take-modal': () => {
                    if (typeof _modal_stock_stock_take !== 'undefined' && _modal_stock_stock_take.init) _modal_stock_stock_take.init();
                },
                'send-to-dispatch-modal': () => {
                    if (typeof _modal_stock_send_to_dispatch !== 'undefined' && _modal_stock_send_to_dispatch.init) _modal_stock_send_to_dispatch.init();
                },
                'send-to-dispatch-oil-modal': () => {
                    if (typeof _modal_stock_send_to_dispatch_oil !== 'undefined' && _modal_stock_send_to_dispatch_oil.init) _modal_stock_send_to_dispatch_oil.init();
                },
                'sales-forecasting-grid': () => {
                    if (typeof initializeSalesForecastingGrid === 'function') {
                        initializeSalesForecastingGrid();
                    }
                },
                'oil-production-grid': () => {
                    if (typeof initializeOilProductionGrid === 'function') {
                        initializeOilProductionGrid();
                    }
                },
                'oil-production-forecast-grid': () => {
                    if (typeof initializeOilProductionForecastGrid === 'function') {
                        initializeOilProductionForecastGrid();
                    }
                },
                'oil-dispatch-grid': () => {
                    if (typeof _oilDispatchGrid !== 'undefined' && _oilDispatchGrid.init) _oilDispatchGrid.init();
                },
                'financial-management-grid': () => {
                    if (typeof _financialManagementGrid !== 'undefined' && _financialManagementGrid.init) _financialManagementGrid.init();
                },
                'amanda-dashboard': () => {
                    if (typeof initializeAmandaDashboard === 'function') {
                        initializeAmandaDashboard();
                    }
                },
                'executive-dashboard': () => {
                    if (typeof _executiveDashboard !== 'undefined' && _executiveDashboard.init) _executiveDashboard.init();
                },
                'document-management-grid': () => {
                    if (typeof initializeDocumentManagementGrid === 'function') {
                        initializeDocumentManagementGrid();
                    }
                },
                'palladium-integration-grid': () => {
                    if (typeof initializePalladiumIntegrationGrid === 'function') {
                        initializePalladiumIntegrationGrid();
                    }
                },
                'test-scenarios-grid': () => {
                    if (typeof initializeTestScenariosGrid === 'function') {
                        initializeTestScenariosGrid();
                    }
                },
                'batch-journey': () => {
                    if (typeof _batchJourneyGrid !== 'undefined' && _batchJourneyGrid.init) {
                        _batchJourneyGrid.init();
                    }
                },
                'batch-history-modal': () => {
                    if (typeof _modal_batch_history !== 'undefined' && _modal_batch_history.init) {
                        _modal_batch_history.init();
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
            Session.set('lastActivePage', routeName);
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
            var doNavigate = function () {
                sessionStorage.setItem('lastActivePage', routeName);
                Session.set('lastActivePage', routeName);
                _appRouter.currentRoute = routeName;
                return _appRouter.loadContent({
                    routeName: routeName,
                    elementSelector: _appRouter.contentContainer
                });
            };

            var isLeavingStockKernel = _appRouter.currentRoute === 'stock-management-kernel';
            if (isLeavingStockKernel && typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.hasDispatchDraft && _stockManagementGrid.hasDispatchDraft()) {
                const result = await Swal.fire({
                    title: 'Save dispatch selection?',
                    text: 'You have entered dispatch details and selected boxes. Save as draft before leaving?',
                    icon: 'question',
                    showCancelButton: true,
                    showDenyButton: true,
                    confirmButtonText: 'Save as draft',
                    denyButtonText: 'Discard',
                    cancelButtonText: 'Cancel',
                    confirmButtonColor: '#3085d6',
                    denyButtonColor: '#d33',
                    cancelButtonColor: '#6c757d',
                    backdrop: 'rgb(245 247 250 / 40%)'
                });
                if (result.isConfirmed) {
                    if (_stockManagementGrid.saveDispatchDraft) _stockManagementGrid.saveDispatchDraft();
                    await doNavigate();
                    return;
                }
                if (result.isDenied) {
                    if (_stockManagementGrid.clearDispatchDraft) _stockManagementGrid.clearDispatchDraft();
                    await doNavigate();
                    return;
                }
                return;
            }

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
                    await doNavigate();
                }
            }
            else {
                await doNavigate();
            }
        },
        getEnvironment: () => {

            // Production is an exact-match allowlist: a host must be listed
            // here to ever resolve to the production database. Every other
            // host (localhost, dev, old uat, anything unknown) uses dev, so a
            // misconfigured or new deployment can never write to prod data.
            const PROD_HOSTS = ['macavation.customapp.org'];

            const host = (location.hostname || '').toLowerCase();

            if (PROD_HOSTS.indexOf(host) > -1) {
                return 'prod';
            }
            if (host.indexOf('demo') === 0) {
                return 'demo';
            }
            return 'dev';
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

            const breadCrumbsRaw = sessionStorage.getItem('breadCrumbs');
            const breadCrumbs = breadCrumbsRaw ? JSON.parse(breadCrumbsRaw) : [];

            const routeParamsRaw = sessionStorage.getItem('routeParams');
            const routeParamsStore = routeParamsRaw ? JSON.parse(routeParamsRaw) : {};

            const breadCrumbsHtml = breadCrumbs.map((routeName, i) => {

                const routeConfig = _appRouter.routeConfig[routeName];
                if (!routeConfig) return '';

                const isLast = breadCrumbs.length === (i + 1);

                let itemLabel = routeConfig.description || routeName;

                const itemParams = routeParamsStore[routeName];

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
                        _appRouter.SupabaseAnonKey = environmentSetting.SupabaseAnonKey || '';
                        _appRouter.LambdaProxyUrl = environmentSetting.LambdaProxyUrl;
                        if (typeof dataFunctions !== 'undefined' && dataFunctions) {
                            if (environmentSetting.LambdaProxyUrl) {
                                dataFunctions.proxyUrl = environmentSetting.LambdaProxyUrl;
                            }
                            if (environmentSetting.SupabaseUrl) {
                                if (typeof window.MACAVATION_SUPABASE !== 'undefined') {
                                    window.MACAVATION_SUPABASE.assertMacavationSupabaseUrl(environmentSetting.SupabaseUrl);
                                }
                                dataFunctions.supabaseUrl = environmentSetting.SupabaseUrl;
                            }
                            if (environmentSetting.SupabaseAnonKey) {
                                dataFunctions.supabaseAnonKey = environmentSetting.SupabaseAnonKey;
                            }
                        }
                    }
                })
                .catch(error => {
                    console.error('There was a problem fetching the config:', error);
                    throw error;
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
