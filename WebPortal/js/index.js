/**
 * Index page script – extracted from index.html
 * Bootstrap tabs, PWA, auth check, user display, sidebar, menu visibility.
 */

// Ensure Bootstrap tabs work even in sandboxed preview environments by manually triggering Tab.show
(function ensureBootstrapTabsWork() {
    if (typeof bootstrap === 'undefined' || !bootstrap.Tab) return;
    let bound = false;
    const bind = () => {
        if (bound) return;
        bound = true;
        document.addEventListener('click', function (e) {
            const toggleEl = e.target.closest('a[data-bs-toggle="tab"], button[data-bs-toggle="tab"]');
            if (!toggleEl) return;
            if (toggleEl.tagName === 'A') e.preventDefault();
            try {
                const instance = bootstrap.Tab.getOrCreateInstance(toggleEl);
                instance.show();
            } catch (err) {
                console.warn('[Tabs] Fallback activation failed:', err);
            }
        }, true);
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }
})();

// Service Worker registration temporarily disabled to stabilize local/preview behavior
(function () {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations()
            .then(regs => regs.forEach(r => r.unregister()))
            .catch(() => {});
    }
    console.log('[PWA] Service Worker registration disabled (local/dev).');
})();

// Initialize application
document.addEventListener('DOMContentLoaded', function () {
    document.body.classList.remove('modal-open');
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
    document.querySelectorAll('.modal-backdrop').forEach(function (el) { el.remove(); });

    if (typeof bootstrap !== 'undefined') {
        document.querySelectorAll('[data-bs-toggle="dropdown"]').forEach(function (el) {
            try { bootstrap.Dropdown.getOrCreateInstance(el); } catch (e) { }
        });
        document.querySelectorAll('[data-bs-toggle="collapse"]').forEach(function (el) {
            try { bootstrap.Collapse.getOrCreateInstance(el); } catch (e) { }
        });
    }

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && typeof window.forceCloseAllModals === 'function') {
            try { window.forceCloseAllModals(); } catch (err) { console.warn('ESC panic close failed', err); }
        }
    }, true);

    if (typeof offlineDetector !== 'undefined') {
        offlineDetector.init();
    }
    if (typeof offlineSync !== 'undefined') {
        offlineSync.init();
    }

    const isAuthenticated = (typeof dataFunctions !== 'undefined' && dataFunctions.isAuthenticated()) ||
        (typeof authService !== 'undefined' && authService.isAuthenticated());

    if (!isAuthenticated) {
        const ccParam = localStorage.getItem('client_guid') ||
            new URLSearchParams(window.location.search).get('cc') ||
            '9e1d961a-bfc2-469d-8526-8af75f536656';
        const signinUrl = `signin.html?cc=${encodeURIComponent(ccParam)}`;
        window.location.href = signinUrl;
        return;
    }

    try {
        initializeSidebarCollapse();
        initializeSidebarToggle();
        updateUserDisplay();
        initProfilePicture();
        initProfilePictureInput();

        if (typeof menuFilter !== 'undefined') {
            setTimeout(function () {
                menuFilter.init();
                // Delayed refresh passes so sidebar updates after async feature fetch completes
                setTimeout(function () { if (menuFilter.refresh) menuFilter.refresh(); }, 1200);
                setTimeout(function () { if (menuFilter.refresh) menuFilter.refresh(); }, 2500);
            }, 500);
        }

        const userManagementCollapse = document.getElementById('userManagementCollapse');
        if (userManagementCollapse) {
            userManagementCollapse.classList.remove('show');
            const userManagementToggle = document.querySelector('[data-bs-target="#userManagementCollapse"]');
            if (userManagementToggle) {
                userManagementToggle.setAttribute('aria-expanded', 'false');
            }
            var systemAdminItem = document.getElementById('systemAdminMenuItem');
            var userManagementItem = document.getElementById('userManagementMenuItem');
            if (systemAdminItem && userManagementItem && userManagementItem.nextElementSibling !== systemAdminItem) {
                systemAdminItem.insertAdjacentElement('beforebegin', userManagementItem);
            }
        }

        var myDayDropdownNav = document.getElementById('myDayDropdownNav');
        if (myDayDropdownNav && typeof workflowViews !== 'undefined') {
            myDayDropdownNav.addEventListener('shown.bs.dropdown', function () {
                var body = document.getElementById('myDayDropdownBody');
                if (!body) return;
                workflowViews.getMyDayData().then(function (data) {
                    body.innerHTML = workflowViews.renderMyDayDropdownSummary(data);
                }).catch(function () {
                    body.innerHTML = '<p class="text-muted small mb-0">Unable to load summary.</p>';
                });
            });
        }
        var myDayViewFullLink = document.getElementById('myDayViewFullLink');
        if (myDayViewFullLink) {
            myDayViewFullLink.addEventListener('click', function (e) {
                e.preventDefault();
                if (typeof _appRouter !== 'undefined' && _appRouter.routeTo) {
                    _appRouter.routeTo('my-day');
                }
                var menu = document.getElementById('myDayDropdownMenu');
                if (menu && typeof bootstrap !== 'undefined' && bootstrap.Dropdown) {
                    var toggle = document.getElementById('myDayDropdownToggle');
                    if (toggle) { var inst = bootstrap.Dropdown.getInstance(toggle); if (inst) inst.hide(); }
                }
            });
        }
    } catch (err) {
        console.error('[Index init] Sidebar/display init error:', err);
    }
});

function updateUserDisplay() {
    try {
        const user = Session.get('user');
        if (!user) {
            console.warn('No user info found in session');
            updateUserNameDisplay('User');
            return;
        }
        let displayName = 'User';
        if (user.full_name) {
            displayName = user.full_name;
        } else if (user.first_name || user.last_name) {
            displayName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
            if (!displayName) displayName = 'User';
        } else if (user.email) {
            displayName = user.email.split('@')[0];
        } else if (user.username) {
            displayName = user.username;
        }

        updateUserNameDisplay(displayName);

        const setEl = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text || '—'; };
        setEl('userInfoName', displayName);
        setEl('userInfoEmail', user.email);
        setEl('userInfoUsername', user.username);

        const roleDisplay = document.getElementById('userRoleDisplay');
        if (roleDisplay) {
            const updateRoleDisplay = (roleName) => {
                if (!roleName) roleName = 'User';
                roleDisplay.textContent = roleName;
                setEl('userInfoRole', roleName);
                if (roleName.startsWith('PWA ')) {
                    roleDisplay.className = 'badge bg-info text-white';
                } else if (roleName === 'admin' || roleName === 'super_user') {
                    roleDisplay.className = 'badge bg-success text-white';
                } else {
                    roleDisplay.className = 'text-muted';
                }
            };

            let roleName = null;
            if (user.role_name) {
                roleName = user.role_name;
            } else if (user.role) {
                if (typeof user.role === 'string') {
                    roleName = user.role;
                } else if (typeof user.role === 'object' && user.role !== null) {
                    roleName = user.role.role_name || user.role.name || null;
                }
            }

            if (roleName) {
                updateRoleDisplay(roleName);
            } else {
                updateRoleDisplay('Loading...');
                const userId = user.id || user.user_id;
                if (typeof dataFunctions !== 'undefined' && userId) {
                    (async function () {
                        try {
                            const userData = await dataFunctions.getUserById(userId);
                            if (userData && userData.role_name) {
                                user.role_name = userData.role_name;
                                if (userData.role_id != null) user.role_id = userData.role_id;
                                Session.set('user', user);
                                updateRoleDisplay(userData.role_name);
                                if (user.role_id && typeof authService !== 'undefined' && authService.fetchAndCacheFeatures) {
                                    authService.fetchAndCacheFeatures(user.role_id);
                                }
                                if (typeof menuFilter !== 'undefined' && menuFilter.refresh) menuFilter.refresh();
                                return;
                            }
                            if (user.role_id) {
                                const roles = await dataFunctions.getRoles();
                                if (roles && Array.isArray(roles)) {
                                    const userRole = roles.find(r => r.id === user.role_id);
                                    if (userRole && userRole.role_name) {
                                        user.role_name = userRole.role_name;
                                        Session.set('user', user);
                                        updateRoleDisplay(userRole.role_name);
                                        if (user.role_id && typeof authService !== 'undefined' && authService.fetchAndCacheFeatures) {
                                            authService.fetchAndCacheFeatures(user.role_id);
                                        }
                                        if (typeof menuFilter !== 'undefined' && menuFilter.refresh) menuFilter.refresh();
                                        return;
                                    }
                                }
                            }
                            const users = await dataFunctions.getUsers();
                            if (users && Array.isArray(users)) {
                                const currentUser = users.find(u => u.id === userId || u.email === user.email);
                                if (currentUser && (currentUser.role_name || currentUser.role)) {
                                    const foundRole = currentUser.role_name || currentUser.role;
                                    user.role_name = foundRole;
                                    if (currentUser.role_id != null) user.role_id = currentUser.role_id;
                                    Session.set('user', user);
                                    updateRoleDisplay(foundRole);
                                    if (user.role_id && typeof authService !== 'undefined' && authService.fetchAndCacheFeatures) {
                                        authService.fetchAndCacheFeatures(user.role_id);
                                    }
                                    if (typeof menuFilter !== 'undefined' && menuFilter.refresh) menuFilter.refresh();
                                    return;
                                }
                            }
                            updateRoleDisplay('User');
                        } catch (error) {
                            console.warn('Could not fetch role name:', error);
                            updateRoleDisplay('User');
                        }
                    })();
                } else {
                    updateRoleDisplay('User');
                }
            }
        }
    } catch (error) {
        console.error('Error loading user info:', error);
        updateUserNameDisplay('User');
    }
}

function updateUserNameDisplay(name) {
    const displayNameSpan = document.getElementById('userDisplayName');
    const dropdownNameDiv = document.getElementById('userDisplayNameDropdown');
    if (displayNameSpan) displayNameSpan.textContent = name;
    if (dropdownNameDiv) dropdownNameDiv.textContent = name;
}

function initProfilePicture() {
    const dataUrl = localStorage.getItem('user_profile_image');
    const img = document.getElementById('userProfileImage');
    const placeholder = document.getElementById('userProfilePlaceholder');
    if (!dataUrl) return;
    if (img && placeholder) {
        img.src = dataUrl;
        img.classList.remove('d-none');
        placeholder.classList.add('d-none');
    }
    var navAvatar = document.querySelector('.navbar .nav-item.dropdown .avatar .avatar-name');
    if (navAvatar && navAvatar.parentElement) {
        var navImg = navAvatar.parentElement.querySelector('img.navbar-profile-img');
        if (!navImg) {
            navImg = document.createElement('img');
            navImg.className = 'navbar-profile-img rounded-circle';
            navImg.alt = 'Profile';
            navImg.style.width = navImg.style.height = '100%';
            navImg.style.objectFit = 'cover';
            navAvatar.parentElement.insertBefore(navImg, navAvatar);
            navAvatar.classList.add('d-none');
        }
        navImg.src = dataUrl;
    }
}

function initProfilePictureInput() {
    const input = document.getElementById('profilePictureInput');
    const img = document.getElementById('userProfileImage');
    const placeholder = document.getElementById('userProfilePlaceholder');
    if (!input || !img || !placeholder) return;
    input.addEventListener('change', function () {
        const file = this.files && this.files[0];
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = function () {
            const dataUrl = reader.result;
            localStorage.setItem('user_profile_image', dataUrl);
            img.src = dataUrl;
            img.classList.remove('d-none');
            placeholder.classList.add('d-none');
            var navPlace = document.querySelector('.navbar .avatar .avatar-name');
            var navImg = document.querySelector('.navbar .navbar-profile-img');
            if (navPlace && navPlace.parentElement) {
                if (!navImg) {
                    navImg = document.createElement('img');
                    navImg.className = 'navbar-profile-img rounded-circle';
                    navImg.alt = 'Profile';
                    navImg.style.width = navImg.style.height = '100%';
                    navImg.style.objectFit = 'cover';
                    navPlace.parentElement.insertBefore(navImg, navPlace);
                    navPlace.classList.add('d-none');
                }
                navImg.src = dataUrl;
            }
        };
        reader.readAsDataURL(file);
        this.value = '';
    });
}

function showChangePassword() {
    if (typeof Swal !== 'undefined') {
        Swal.fire({
            title: 'Change password',
            text: 'Password change can be done from the User Management area or your identity provider.',
            icon: 'info',
            confirmButtonText: 'OK'
        });
    } else {
        alert('Change password is available from User Management or your identity provider.');
    }
}

function initializeSidebarCollapse() {
    const userManagementToggle = document.querySelector('[data-bs-target="#userManagementCollapse"]');
    const userManagementCollapse = document.getElementById('userManagementCollapse');
    const sidebar = document.getElementById('sidebarMenu');

    if (userManagementToggle && userManagementCollapse) {
        userManagementToggle.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
        });

        document.addEventListener('click', function (e) {
            if (sidebar && sidebar.classList.contains('collapsed')) {
                const isClickInside = userManagementCollapse.contains(e.target) ||
                    userManagementToggle.contains(e.target);
                if (!isClickInside && userManagementCollapse.classList.contains('show')) {
                    const bsCollapse = bootstrap.Collapse.getInstance(userManagementCollapse);
                    if (bsCollapse) bsCollapse.hide();
                }
            }
        });

        userManagementCollapse.addEventListener('show.bs.collapse', function () {
            if (sidebar && sidebar.classList.contains('collapsed')) {
                const navItem = userManagementToggle.closest('.nav-item');
                if (navItem) {
                    const navItemRect = navItem.getBoundingClientRect();
                    userManagementCollapse.style.top = navItemRect.top + 'px';
                    userManagementCollapse.style.left = '70px';
                    userManagementCollapse.style.position = 'fixed';
                }
            } else {
                userManagementCollapse.style.top = '';
                userManagementCollapse.style.left = '';
                userManagementCollapse.style.position = '';
            }
        });

        userManagementCollapse.addEventListener('hide.bs.collapse', function () {
            userManagementCollapse.style.top = '';
            userManagementCollapse.style.left = '';
            userManagementCollapse.style.position = '';
        });
    }

    initializeActiveStates();
}

function initializeActiveStates() {
    const navLinks = document.querySelectorAll('.sidebar .nav-link');
    const sidebar = document.getElementById('sidebarMenu');
    const userManagementCollapse = document.getElementById('userManagementCollapse');

    navLinks.forEach(link => {
        if (link.hasAttribute('route')) return;
        link.addEventListener('click', function (e) {
            navLinks.forEach(l => l.classList.remove('active'));
            this.classList.add('active');

            const parentCollapse = this.closest('.collapse');
            if (parentCollapse) {
                const parentToggle = document.querySelector(`[data-bs-target="#${parentCollapse.id}"]`);
                if (parentToggle && !parentCollapse.classList.contains('show')) {
                    parentToggle.click();
                }
            }

            if (sidebar && sidebar.classList.contains('collapsed') &&
                userManagementCollapse &&
                this.closest('#userManagementCollapse')) {
                const bsCollapse = bootstrap.Collapse.getInstance(userManagementCollapse);
                if (bsCollapse) bsCollapse.hide();
            }
        });
    });
}

function initializeSidebarToggle() {
    var sidebarToggle = document.getElementById('sidebarToggle');
    var sidebar = document.getElementById('sidebarMenu');
    var mainContent = document.querySelector('.main-content');

    // ── CSS-only tooltip helpers ──
    // Move `title` → `data-tip` so CSS ::after can read it
    // (also suppresses the native browser tooltip)
    function enableCssTips() {
        if (!sidebar) return;
        sidebar.querySelectorAll('.flex-grow-1 > ul > .nav-item > .nav-link[title]').forEach(function (el) {
            if (!el.getAttribute('data-tip')) {
                el.setAttribute('data-tip', el.getAttribute('title'));
            }
            el.removeAttribute('title');
        });
    }

    function restoreTitles() {
        if (!sidebar) return;
        sidebar.querySelectorAll('.flex-grow-1 > ul > .nav-item > .nav-link[data-tip]').forEach(function (el) {
            el.setAttribute('title', el.getAttribute('data-tip'));
        });
    }

    // ── Flyout helpers ──
    var activeFlyout = null;

    function closeFlyout() {
        if (activeFlyout) {
            activeFlyout.remove();
            activeFlyout = null;
        }
        document.removeEventListener('click', onDocClickFlyout, true);
    }

    function onDocClickFlyout(e) {
        if (activeFlyout && !activeFlyout.contains(e.target)) {
            closeFlyout();
        }
    }

    function openFlyout(navItem) {
        closeFlyout();

        // Find the collapse panel inside this nav-item
        var collapseDiv = navItem.querySelector('.collapse');
        if (!collapseDiv) return;

        // Build flyout element
        var flyout = document.createElement('div');
        flyout.className = 'sidebar-flyout';

        // Get the label from the nav-link title
        var link = navItem.querySelector('.nav-link');
        var title = link ? (link.getAttribute('title') || '') : '';
        if (title) {
            var header = document.createElement('div');
            header.className = 'sidebar-flyout-header';
            header.textContent = title;
            flyout.appendChild(header);
        }

        // Clone sub-menu links
        var subLinks = collapseDiv.querySelectorAll('.nav-link[route]');
        subLinks.forEach(function (sl) {
            // Only include visible items (menu-filter may have hidden some)
            var parentItem = sl.closest('.nav-item');
            if (parentItem && parentItem.style.display === 'none') return;

            var item = document.createElement('a');
            item.className = 'sidebar-flyout-item';
            item.href = '#';
            item.setAttribute('route', sl.getAttribute('route'));
            item.setAttribute('title', sl.getAttribute('title') || '');
            // Copy icon + text
            var icon = sl.querySelector('i');
            if (icon) {
                item.appendChild(icon.cloneNode(true));
            }
            item.appendChild(document.createTextNode(sl.textContent.trim()));
            item.addEventListener('click', function (e) {
                e.preventDefault();
                // Trigger the real nav-link click
                sl.click();
                closeFlyout();
            });
            flyout.appendChild(item);
        });

        if (flyout.querySelectorAll('.sidebar-flyout-item').length === 0) return;

        // Position: right of the sidebar, aligned to the nav-item
        document.body.appendChild(flyout);
        var rect = navItem.getBoundingClientRect();
        var sidebarWidth = sidebar.getBoundingClientRect().right;
        flyout.style.top = rect.top + 'px';
        flyout.style.left = sidebarWidth + 'px';

        // Clamp bottom if it would overflow viewport
        requestAnimationFrame(function () {
            var flyRect = flyout.getBoundingClientRect();
            if (flyRect.bottom > window.innerHeight - 8) {
                flyout.style.top = Math.max(8, window.innerHeight - flyRect.height - 8) + 'px';
            }
        });

        activeFlyout = flyout;
        // Delay listener to avoid immediate close from the same click
        setTimeout(function () {
            document.addEventListener('click', onDocClickFlyout, true);
        }, 0);
    }

    // ── Sidebar toggle ──
    if (sidebarToggle && sidebar && mainContent) {
        sidebarToggle.addEventListener('click', function () {
            var wasCollapsed = sidebar.classList.contains('collapsed');
            sidebar.classList.toggle('collapsed');
            mainContent.classList.toggle('sidebar-collapsed');

            if (!wasCollapsed) {
                // Collapsing: close all open submenu panels
                sidebar.querySelectorAll('.collapse.show').forEach(function (panel) {
                    var bsC = bootstrap.Collapse.getInstance(panel);
                    if (bsC) bsC.hide();
                    else panel.classList.remove('show');
                });
                enableCssTips();
            } else {
                // Expanding
                restoreTitles();
                closeFlyout();
            }
        });

        // Init tips if sidebar starts collapsed
        if (sidebar.classList.contains('collapsed')) {
            enableCssTips();
        }
    }

    // ── Intercept dropdown clicks when collapsed → open flyout ──
    // CAPTURE phase so we fire before Bootstrap's collapse handler
    if (sidebar) {
        sidebar.addEventListener('click', function (e) {
            if (!sidebar.classList.contains('collapsed')) return;
            var collapseLink = e.target.closest('.nav-link[data-bs-toggle="collapse"]');
            if (!collapseLink) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            var navItem = collapseLink.closest('.nav-item');
            if (navItem) openFlyout(navItem);
        }, true);
    }

    // Dark mode toggle
    var darkToggle = document.getElementById('darkModeToggle');
    if (darkToggle) {
        darkToggle.addEventListener('click', function () {
            if (typeof ThemeManager !== 'undefined' && ThemeManager.toggleDarkMode) {
                ThemeManager.toggleDarkMode();
            }
        });
    }
}

function testNavigation() {
    console.log('Navigation test clicked!');
    alert('Navigation is working!');
}

function showProfile() {
    Swal.fire({
        icon: 'info',
        title: 'Profile Management',
        text: 'Profile management will be implemented.',
        confirmButtonColor: '#0d6efd'
    });
}

function showSettings() {
    Swal.fire({
        icon: 'info',
        title: 'Settings',
        text: 'Settings page will be implemented.',
        confirmButtonColor: '#0d6efd'
    });
}

function signOut() {
    Swal.fire({
        title: 'Sign Out',
        text: 'Are you sure you want to sign out?',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#dc3545',
        cancelButtonColor: '#6c757d',
        confirmButtonText: 'Yes, sign out!',
        cancelButtonText: 'Cancel'
    }).then((result) => {
        if (result.isConfirmed) {
            const lastActivePage = sessionStorage.getItem('lastActivePage') ||
                (typeof _appRouter !== 'undefined' && _appRouter.currentRoute) ||
                'dashboard';
            const ccParam = Session.get('clientGuid');

            if (typeof authService !== 'undefined' && typeof authService.signOut === 'function') {
                authService.signOut();
            } else {
                Session.clear();
                Session.set('lastActivePage', lastActivePage);
                const signinUrl = ccParam ? `signin.html?cc=${encodeURIComponent(ccParam)}` : 'signin.html';
                window.location.href = signinUrl;
            }
        }
    });
}

function updateMenuVisibility() {
    const testManagementMenuItem = document.getElementById('testScenariosMenuItem');
    if (testManagementMenuItem && typeof dataFunctions !== 'undefined') {
        testManagementMenuItem.style.display = dataFunctions.canAccessTestManagement() ? 'block' : 'none';
    }
}

async function initMenuVisibilityWhenReady() {
    try {
        if (typeof waitForDataFunctions === 'function') {
            await waitForDataFunctions();
        }
        if (typeof dataFunctions !== 'undefined' && dataFunctions.isAuthenticated()) {
            updateMenuVisibility();
        }
    } catch (e) {
        console.warn('[Menu visibility] init skipped:', e);
    }
}

document.addEventListener('DOMContentLoaded', function () {
    initMenuVisibilityWhenReady();
});
