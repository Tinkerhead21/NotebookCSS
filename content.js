/**
 * NotebookLM Source Organizer - Content Script
 * Organizes the "Sources" sidebar using CSS native Flex order without breaking React DOM.
 */

// ==========================================================================
// Variables & Selectors
// ==========================================================================
let currentNotebookId = null;

/**
 * State Structure:
 * {
 *   "notebook_id": {
 *     "customFolders": ["Project Alpha", "References"],
 *     "sourceMapping": { "source_id_1": "Project Alpha" }
 *   }
 * }
 */
let notebookState = {
    customFolders: [],
    sourceMapping: {}
};

// Selectors for NotebookLM
const SELECTORS = {
    SIDEBAR_CONTAINER: '[data-testid="sources-sidebar"]', 
    SOURCES_LIST: '[data-testid="sources-list-container"]', 
    SOURCE_ITEM: '.native-source-item', 
    SOURCE_TITLE: '.source-title',
    SOURCE_CHECKBOX: 'input[type="checkbox"]:not(.enhancer-custom-selector)' 
};

// Cached live DOM elements
let LIVE_SOURCES_LIST_EL = null;
let ITEM_SELECTOR_CLASS = '';

// Update selectors dynamically based on structure (bottom-up approach)
function discoverSelectors() {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        LIVE_SOURCES_LIST_EL = document.querySelector(SELECTORS.SOURCES_LIST);
        ITEM_SELECTOR_CLASS = '.native-source-item';
        return true;
    }

    // Direct targeting for NotebookLM's actual Angular app structure based on provided HTML
    const angularList = document.querySelector('.scroll-area-desktop');
    if (angularList) {
        LIVE_SOURCES_LIST_EL = angularList;
        ITEM_SELECTOR_CLASS = '.single-source-container';
        SELECTORS.SOURCES_LIST = '.scroll-area-desktop';
        SELECTORS.SOURCE_ITEM = '.single-source-container';
        SELECTORS.SOURCE_TITLE = '.source-title span';
        return true; // Fast exit if we successfully grabbed it
    }

    // Fallback: Find all checkboxes on the page
    const cbs = Array.from(document.querySelectorAll('input[type="checkbox"], [role="checkbox"]'));
    let validCb = null;
    
    // Ignore the "Select all sources" checkbox, pick the first actual source checkbox
    for (const cb of cbs) {
        const rowDiv = cb.closest('div');
        if (rowDiv && rowDiv.textContent.toLowerCase().includes('select all sources')) {
            continue;
        }
        if (!validCb) {
            validCb = cb;
            break;
        }
    }

    if (!validCb) return false;

    // Climb from validCb to find the container that holds all the source items
    let current = validCb;
    let listContainer = null;
    let itemClass = '';

    while (current && current.tagName !== 'BODY') {
        const parent = current.parentElement;
        if (parent && parent.children.length > 1) {
            // Count how many children have checkboxes - if multiple, it's our list container!
            const children = Array.from(parent.children);
            const sourceChildren = children.filter(c => c.querySelector('input[type="checkbox"], [role="checkbox"]'));
            
            if (sourceChildren.length > 1) {
                listContainer = parent;
                // Grab the class list of the first item to use as a reliable query selector
                const classList = Array.from(sourceChildren[0].classList);
                itemClass = classList.length > 0 ? '.' + classList.join('.') : '*';
                break;
            }
        }
        current = parent;
    }

    if (listContainer) {
        LIVE_SOURCES_LIST_EL = listContainer;
        ITEM_SELECTOR_CLASS = (itemClass !== '*') ? itemClass : 'div';
        
        if (validCb.hasAttribute('role')) {
            SELECTORS.SOURCE_CHECKBOX = `[role="${validCb.getAttribute('role')}"]`;
        } else {
            SELECTORS.SOURCE_CHECKBOX = 'input[type="checkbox"]';
        }
        return true;
    }
    return false;
}

// ==========================================================================
// State Management
// ==========================================================================
function getNotebookIdFromUrl() {
    // Works for both live /notebook/id and localhost
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'mock-notebook-id';
    }
    const match = window.location.pathname.match(/\/notebook\/([a-zA-Z0-9-]+)/);
    return match ? match[1] : null;
}

async function initializeState() {
    currentNotebookId = getNotebookIdFromUrl();
    if (!currentNotebookId) {
        console.log('[Source Organizer] Not inside a notebook. Extension inactive.');
        return false;
    }

    try {
        const data = await chrome.storage.sync.get([currentNotebookId]);
        notebookState = data[currentNotebookId] || {
            customFolders: [],
            sourceMapping: {}
        };
        console.log('[Source Organizer] State loaded for notebook ' + currentNotebookId, notebookState);
        return true;
    } catch (err) {
        console.error('[Source Organizer] Failed to load state:', err);
        // Fallback for isolated testing environments without chrome.storage
        notebookState = { customFolders: [], sourceMapping: {} };
        return true;
    }
}

async function saveState() {
    if (!currentNotebookId) return;
    try {
        if (chrome.storage && chrome.storage.sync) {
            await chrome.storage.sync.set({ [currentNotebookId]: notebookState });
        }
    } catch (err) {
        console.error('[Source Organizer] Failed to save state:', err);
    }
}

// ==========================================================================
// Observer & Init
// ==========================================================================
function setupObserver() {
    const observer = new MutationObserver((mutations) => {
        // Check for URL changes
        const newId = getNotebookIdFromUrl();
        if (newId !== currentNotebookId) {
            currentNotebookId = newId;
            if (newId) {
                initializeState().then(success => {
                    if(success) {
                        discoverSelectors();
                        enhanceSidebar();
                    }
                });
            }
        }

        if (!currentNotebookId) return;
        
        let shouldEnhance = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                shouldEnhance = true;
                break;
            }
        }
        
        if (shouldEnhance) {
            clearTimeout(window._enhanceTimeout);
            window._enhanceTimeout = setTimeout(enhanceSidebar, 200);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

// ==========================================================================
// UI Augmentation (Non-Destructive flex order)
// ==========================================================================
function enhanceSidebar() {
    // Ensure we've discovered the element
    if (!LIVE_SOURCES_LIST_EL) {
        discoverSelectors();
    }
    
    const sourcesList = LIVE_SOURCES_LIST_EL || document.querySelector(SELECTORS.SOURCES_LIST);
    
    if (!sourcesList) return;

    if (sourcesList.parentNode) {
        sourcesList.parentNode.classList.add('enhancer-sidebar-container');
    }

    // We must ensure the list container acts as a flex column, otherwise CSS 'order' property does absolutely nothing!
    sourcesList.classList.add('enhancer-flex-grouping-container');

    injectFolderUI(sourcesList);
    processSourceItems(sourcesList);
}

function assignFolderColors() {
    // Generate a map of folder -> order number (e.g. index * 100)
    const folderOrders = {};
    notebookState.customFolders.forEach((folderName, index) => {
        // order 100, 200, 300...
        folderOrders[folderName] = (index + 1) * 100;
    });
    return folderOrders;
}

function injectFolderUI(sourcesList) {
    // 1. Add Folder Button & Bulk Actions (inserted just *before* the sources list wrapper)
    let opsWrapper = document.querySelector('.enhancer-top-actions-wrapper');
    if (!opsWrapper) {
        opsWrapper = document.createElement('div');
        opsWrapper.className = 'enhancer-top-actions-wrapper';

        // Add Folder
        const addBtn = document.createElement('button');
        addBtn.className = 'enhancer-add-folder-btn';
        addBtn.innerHTML = '<span>➕</span> Add Folder';
        addBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const name = prompt('Enter a new folder name:');
            if (name && name.trim() !== '') {
                const trimmed = name.trim();
                if (!notebookState.customFolders.includes(trimmed)) {
                    console.log(`[Source Organizer] Adding folder: ${trimmed}`);
                    notebookState.customFolders.push(trimmed);
                    saveState().then(enhanceSidebar);
                } else {
                    alert('Folder already exists!');
                }
            }
        });

        // Bulk Actions Bar
        const bulkBar = document.createElement('div');
        bulkBar.className = 'enhancer-bulk-action-bar';
        
        const bulkMove = document.createElement('button');
        bulkMove.className = 'enhancer-bulk-btn';
        bulkMove.textContent = 'Move to';
        bulkMove.onclick = handleBulkMove;

        const bulkUngroup = document.createElement('button');
        bulkUngroup.className = 'enhancer-bulk-btn';
        bulkUngroup.textContent = 'Ungroup';
        bulkUngroup.style.flex = "1.5"; // Give it slightly more space
        bulkUngroup.onclick = handleBulkUngroup;

        bulkBar.appendChild(bulkMove);
        bulkBar.appendChild(bulkUngroup);

        opsWrapper.appendChild(addBtn);
        opsWrapper.appendChild(bulkBar);
        sourcesList.parentNode.insertBefore(opsWrapper, sourcesList);
    }

    const folderOrders = assignFolderColors();

    function getColorClass(idx) {
        return 'enhancer-color-' + (idx % 8);
    }

    // 2. Render Folder Headers as Siblings INSIDE the sourcesList
    notebookState.customFolders.forEach((folderName, idx) => {
        let header = sourcesList.querySelector(`.enhancer-folder-header[data-folder-name="${folderName}"]`);
        
        if (!header) {
            header = document.createElement('div');
            header.className = 'enhancer-folder-header';
            header.dataset.folderName = folderName;
            
            const titleWrap = document.createElement('div');
            titleWrap.className = 'enhancer-folder-header-left';
            
            const customCb = document.createElement('input');
            customCb.type = 'checkbox';
            customCb.className = 'enhancer-custom-selector enhancer-folder-selector';
            customCb.title = 'Select all in folder';
            customCb.onclick = (e) => {
                 e.stopPropagation();
                 handleCustomFolderCheckboxToggle(e, folderName);
            };
            titleWrap.appendChild(customCb);

            const titleSpan = document.createElement('span');
            titleSpan.textContent = folderName;
            titleWrap.appendChild(titleSpan);
            
            header.onclick = (e) => {
                if (e.target.closest('input') || e.target.closest('button') || e.target.closest('label')) return;
                header.classList.toggle('collapsed');
                enhanceSidebar();
            };

            header.appendChild(titleWrap);
            
            const rightWrap = document.createElement('div');
            rightWrap.className = 'enhancer-folder-header-right';
            
            // Re-adding the bulk folder toggle (now styled as a custom modern slider switch)
            const bulkFolderToggle = document.createElement('label');
            bulkFolderToggle.className = 'enhancer-folder-toggle-switch';
            bulkFolderToggle.innerHTML = `
              <input type="checkbox" class="enhancer-folder-checkbox" title="Select all in folder" checked>
              <span class="enhancer-slider"></span>
            `;
            const checkbox = bulkFolderToggle.querySelector('input');
            checkbox.onclick = (e) => {
                 e.stopPropagation();
                 handleNativeFolderCheckboxToggle(e, folderName);
            };
            // Note: Appending bulkFolderToggle AFTER menuBtn below.
            
            const menuBtn = document.createElement('button');
            menuBtn.className = 'enhancer-folder-menu-btn';
            menuBtn.setAttribute('aria-label', 'Folder Menu');
            menuBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>`;
            menuBtn.onclick = (e) => {
                e.stopPropagation();
                toggleFolderMenu(rightWrap, folderName);
            };
            rightWrap.appendChild(menuBtn);
            rightWrap.appendChild(bulkFolderToggle);
            
            header.appendChild(rightWrap);
            
            // Inject into the list as a sibling
            sourcesList.appendChild(header);
        }

        // Clear old color classes
        header.className = header.className.replace(/enhancer-color-\d/g, '').trim();
        if (!header.classList.contains('enhancer-folder-header')) {
            header.classList.add('enhancer-folder-header');
        }
        header.classList.add(getColorClass(idx));

        // Apply order dynamically
        const orderVal = folderOrders[folderName];
        header.style.order = orderVal;
    });

    // Cleanup old headers if no longer in state
    const existingHeaders = sourcesList.querySelectorAll('.enhancer-folder-header:not(.unassigned-header)');
    existingHeaders.forEach(header => {
        if (!notebookState.customFolders.includes(header.dataset.folderName)) {
            header.remove();
        }
    });

    // Add Unassigned Sources Folder Header
    let unauthHeader = sourcesList.querySelector('.enhancer-folder-header.unassigned-header');
    if (!unauthHeader) {
        unauthHeader = document.createElement('div');
        unauthHeader.className = 'enhancer-folder-header unassigned-header';
        unauthHeader.dataset.folderName = '__unassigned__';
        
        
        const titleWrap = document.createElement('div');
        titleWrap.className = 'enhancer-folder-header-left';

        const customCb = document.createElement('input');
        customCb.type = 'checkbox';
        customCb.className = 'enhancer-custom-selector enhancer-folder-selector';
        customCb.title = 'Select all in folder';
        customCb.onclick = (e) => {
             e.stopPropagation();
             handleCustomFolderCheckboxToggle(e, null); // Unassigned is null mapping
        };
        titleWrap.appendChild(customCb);

        const titleSpan = document.createElement('span');
        titleSpan.textContent = 'Ungrouped';
        titleWrap.appendChild(titleSpan);
        
        unauthHeader.onclick = (e) => {
            if (e.target.closest('input') || e.target.closest('button') || e.target.closest('label')) return;
            unauthHeader.classList.toggle('collapsed');
            enhanceSidebar();
        };

        unauthHeader.appendChild(titleWrap);
        
        const rightWrap = document.createElement('div');
        rightWrap.className = 'enhancer-folder-header-right';
        
        // Re-adding the bulk folder toggle (styled as a switch) for Unassigned
        const bulkFolderToggle = document.createElement('label');
        bulkFolderToggle.className = 'enhancer-folder-toggle-switch';
        bulkFolderToggle.innerHTML = `
          <input type="checkbox" class="enhancer-folder-checkbox" title="Select all in folder" checked>
          <span class="enhancer-slider"></span>
        `;
        const checkbox = bulkFolderToggle.querySelector('input');
        checkbox.onclick = (e) => {
             e.stopPropagation();
             handleNativeFolderCheckboxToggle(e, null); // Unassigned is null mapping
        };
        rightWrap.appendChild(bulkFolderToggle);
        unauthHeader.appendChild(rightWrap);

        sourcesList.appendChild(unauthHeader);
    }
    unauthHeader.style.order = 998;
}

function toggleFolderMenu(targetNode, folderName) {
    document.querySelectorAll('.enhancer-folder-menu-dropdown').forEach(el => el.remove());
    
    const menu = document.createElement('div');
    menu.className = 'enhancer-folder-menu-dropdown';
    
    // Rename option
    const renameOpt = document.createElement('div');
    renameOpt.className = 'enhancer-submenu-item';
    renameOpt.textContent = 'Rename Folder';
    renameOpt.onclick = (e) => {
        e.stopPropagation();
        menu.remove();
        const newName = prompt('Enter new folder name:', folderName);
        if (newName && newName.trim() && newName.trim() !== folderName) {
            const trimmed = newName.trim();
            if (notebookState.customFolders.includes(trimmed)) {
                alert('A folder with that name already exists.');
                return;
            }
            // Update custom folders
            const idx = notebookState.customFolders.indexOf(folderName);
            if (idx !== -1) notebookState.customFolders[idx] = trimmed;
            
            // Update mapping
            for (const [sId, fName] of Object.entries(notebookState.sourceMapping)) {
                if (fName === folderName) {
                    notebookState.sourceMapping[sId] = trimmed;
                }
            }
            saveState().then(enhanceSidebar);
        }
    };
    menu.appendChild(renameOpt);

    const ungroupOpt = document.createElement('div');
    ungroupOpt.className = 'enhancer-submenu-item';
    ungroupOpt.textContent = 'Ungroup';
    ungroupOpt.onclick = (e) => {
        e.stopPropagation();
        menu.remove();
        if (confirm(`Are you sure you want to ungroup "${folderName}"?\n\nThis will keep the sources in your notebook but move them to Ungrouped.`)) {
            notebookState.customFolders = notebookState.customFolders.filter(f => f !== folderName);
            for (const [sId, fName] of Object.entries(notebookState.sourceMapping)) {
                if (fName === folderName) {
                    delete notebookState.sourceMapping[sId];
                }
            }
            saveState().then(() => processSourceItems(LIVE_SOURCES_LIST_EL));
        }
    };
    menu.appendChild(ungroupOpt);



    targetNode.appendChild(menu);

    setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        });
    }, 0);
}

function processSourceItems(sourcesList) {
    // Collect the native items dynamically using the class we discovered
    let items = [];
    if (ITEM_SELECTOR_CLASS !== 'div' && ITEM_SELECTOR_CLASS !== '') {
        items = Array.from(sourcesList.querySelectorAll(ITEM_SELECTOR_CLASS));
    } else {
        items = Array.from(sourcesList.children);
    }
    
    const folderOrders = assignFolderColors();
    const folderLastItems = {};
    
    items.forEach((item, index) => {
        // Skip our custom injected headers and buttons
        if (item.classList.contains('enhancer-folder-header') || item.classList.contains('enhancer-add-folder-btn')) return;

        // Try extracting text content from the clean title, avoiding the injected action button
        const titleSpan = item.querySelector(SELECTORS.SOURCE_TITLE);
        const rawText = titleSpan ? titleSpan.textContent.trim() : '';
        const id = item.dataset.enhancerId || rawText.replace(/\s+/g, ' ') || `unknown_${index}`;
                   
        if (id.startsWith('unknown_') && rawText === '') return;

        item.dataset.enhancerId = id;
        item.dataset.id = id;
        item.classList.add('enhancer-source-item');
        item.classList.remove('enhancer-folder-last-item');
        item.setAttribute('draggable', 'true');

        // Custom Hover Checkbox
        if (!item.querySelector('.enhancer-custom-selector')) {
            const myCb = document.createElement('input');
            myCb.type = 'checkbox';
            myCb.className = 'enhancer-custom-selector';
            myCb.onclick = (e) => {
                e.stopPropagation();
                updateBulkActionBar();
                syncFolderCheckboxStates();
            };
            item.appendChild(myCb);
        }

        // Remove old custom buttons if they exist
        const oldTrigger = item.querySelector('.enhancer-action-trigger');
        if (oldTrigger) oldTrigger.remove();

        // Apply CSS order and coloring based on assigned folder
        const assignedFolder = notebookState.sourceMapping[id];
        // Strip any existing color classes
        item.className = item.className.replace(/enhancer-color-\d/g, '').trim();

        if (assignedFolder && folderOrders[assignedFolder]) {
            item.style.order = folderOrders[assignedFolder] + 1; // Put it right after the header
            item.classList.add('enhancer-is-nested');
            
            const folderIndex = notebookState.customFolders.indexOf(assignedFolder);
            item.classList.add('enhancer-color-' + (folderIndex % 8));

            // Check if folder is collapsed
            const header = sourcesList.querySelector(`.enhancer-folder-header[data-folder-name="${assignedFolder}"]`);
            if (header && header.classList.contains('collapsed')) {
                item.classList.add('enhancer-hidden');
            } else {
                item.classList.remove('enhancer-hidden');
            }
            folderLastItems[assignedFolder] = item;
        } else {
            // Uncategorized items at bottom
            item.style.order = 999; 
            item.classList.add('enhancer-is-nested');

            // check if unassigned folder is collapsed
            const unassignedHeader = sourcesList.querySelector('.enhancer-folder-header.unassigned-header');
            if (unassignedHeader && unassignedHeader.classList.contains('collapsed')) {
                item.classList.add('enhancer-hidden');
            } else {
                item.classList.remove('enhancer-hidden');
            }
            folderLastItems['__unassigned__'] = item;
        }
    });

    // Tag the actual last items in each group so we can style the fake CSS wrapper correctly
    Object.values(folderLastItems).forEach(itemNode => {
        if(itemNode) itemNode.classList.add('enhancer-folder-last-item');
    });

    // Attempt to convert NotebookLM's Native Select-all checkbox to a toggle
    const allTextNodes = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let masterCbNode = null;
    let node;
    while(node = allTextNodes.nextNode()) {
        if(node.nodeValue && node.nodeValue.toLowerCase().trim() === 'select all sources') {
            masterCbNode = node.parentElement;
            break;
        }
    }
    
    if (masterCbNode) {
        // Navigate up slightly looking for mat-checkbox or a bounding container
        let parent = masterCbNode;
        for (let i = 0; i < 4; i++) {
            if (!parent) break;
            const cb = parent.querySelector('mat-checkbox');
            const inputCb = parent.querySelector('input[type="checkbox"]');
            if (cb) {
                cb.classList.add('enhancer-master-toggle');
                break;
            } else if (inputCb) {
                inputCb.classList.add('enhancer-master-toggle');
                break;
            }
            parent = parent.parentElement;
        }
    }

    syncFolderCheckboxStates();
}

// Augment the native angular material menu when it opens
function augmentNativeMenu(moreBtn) {
    const item = moreBtn.closest('.enhancer-source-item');
    if (!item || !item.dataset.id) return;
    const sourceId = item.dataset.id;
    
    // Find the currently open menu content in the material overlay
    const overlay = document.querySelector('.cdk-overlay-container');
    if (!overlay) return;
    
    const panels = overlay.querySelectorAll('.mat-mdc-menu-panel');
    const activePanel = panels[panels.length - 1]; // get the latest opened one
    if (!activePanel) return;

    const menuContent = activePanel.querySelector('.mat-mdc-menu-content');
    if (!menuContent || menuContent.querySelector('.enhancer-augmented')) return;

    menuContent.classList.add('enhancer-augmented');

    // Add divider
    const divider = document.createElement('div');
    divider.className = 'enhancer-native-menu-divider';
    menuContent.appendChild(divider);

    // Add Move to Folder Submenu (Accordion style to avoid overflow clipping)
    const moveWrapper = document.createElement('div');
    moveWrapper.className = 'enhancer-native-menu-item-wrapper';

    const moveHeader = document.createElement('div');
    moveHeader.className = 'enhancer-native-menu-item';
    moveHeader.innerHTML = `Move to folder <span style="font-size:0.8em; margin-left:auto;">▼</span>`;
    moveWrapper.appendChild(moveHeader);
    
    const submenu = document.createElement('div');
    submenu.className = 'enhancer-submenu-container';
    
    // Helper to forcefully close Angular Modal
    const closeNativeMenu = () => {
        const backdrop = document.querySelector('.cdk-overlay-backdrop');
        if (backdrop) backdrop.click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    };

    notebookState.customFolders.forEach(folder => {
        const subItem = document.createElement('div');
        subItem.className = 'enhancer-submenu-item';
        // highlight current
        subItem.innerHTML = notebookState.sourceMapping[sourceId] === folder ? `✓ ${folder}` : `&nbsp;&nbsp;${folder}`;
        
        subItem.onclick = (e) => {
            e.stopPropagation();
            notebookState.sourceMapping[sourceId] = folder;
            saveState().then(() => {
                closeNativeMenu();
                processSourceItems(LIVE_SOURCES_LIST_EL);
            });
        };
        submenu.appendChild(subItem);
    });
    
    if (notebookState.customFolders.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'enhancer-submenu-item';
        empty.style.color = 'var(--enhancer-text-secondary)';
        empty.textContent = 'Create a folder first';
        submenu.appendChild(empty);
    }

    moveWrapper.appendChild(submenu);
    menuContent.appendChild(moveWrapper);

    // Remove from folder option
    if (notebookState.sourceMapping[sourceId]) {
        const removeOpt = document.createElement('div');
        removeOpt.className = 'enhancer-native-menu-item';
        removeOpt.style.color = '#E91E63'; // Red
        removeOpt.innerHTML = `<span>Remove from folder</span>`;
        removeOpt.onclick = (e) => {
            e.stopPropagation();
            delete notebookState.sourceMapping[sourceId];
            saveState().then(() => {
                closeNativeMenu();
                processSourceItems(LIVE_SOURCES_LIST_EL);
            });
        };
        menuContent.appendChild(removeOpt);
    }
}

// ==========================================================================
// Custom Checkbox & Selection Logic
// ==========================================================================
function handleCustomFolderCheckboxToggle(e, targetFolderName) {
    const isChecked = e.target.checked;
    e.stopPropagation();

    const sourcesList = LIVE_SOURCES_LIST_EL || document.querySelector(SELECTORS.SOURCES_LIST);
    if (!sourcesList) return;
    const items = sourcesList.querySelectorAll(SELECTORS.SOURCE_ITEM);
    
    // Select custom checkboxes inside this folder
    items.forEach(item => {
        const id = item.dataset.id;
        const belongsHere = targetFolderName === null 
             ? !notebookState.sourceMapping[id] // Unassigned
             : notebookState.sourceMapping[id] === targetFolderName;
             
        if (belongsHere) {
            const customCb = item.querySelector('.enhancer-custom-selector');
            if (customCb) {
                customCb.checked = isChecked;
            }
        }
    });

    updateBulkActionBar();
    syncFolderCheckboxStates();
}

function handleNativeFolderCheckboxToggle(e, targetFolderName) {
    const isChecked = e.target.checked;
    e.stopPropagation();

    const sourcesList = LIVE_SOURCES_LIST_EL || document.querySelector(SELECTORS.SOURCES_LIST);
    if (!sourcesList) return;
    const items = sourcesList.querySelectorAll(SELECTORS.SOURCE_ITEM);
    
    items.forEach(item => {
        const id = item.dataset.id;
        const belongsHere = targetFolderName === null 
             ? !notebookState.sourceMapping[id] // Unassigned
             : notebookState.sourceMapping[id] === targetFolderName;
             
        if (belongsHere) {
            const cb = item.querySelector(SELECTORS.SOURCE_CHECKBOX);
            if (cb && cb.checked !== isChecked) {
                // To accurately spoof a user click for React, simulate a click event
                cb.click();
            }
        }
    });

    setTimeout(syncFolderNativeCheckboxStates, 50);
}

function syncFolderCheckboxStates() {
    const sourcesList = LIVE_SOURCES_LIST_EL || document.querySelector(SELECTORS.SOURCES_LIST);
    if (!sourcesList) return;

    const items = sourcesList.querySelectorAll(SELECTORS.SOURCE_ITEM);
    const foldersToSync = [...notebookState.customFolders, null];

    foldersToSync.forEach(folderName => {
        const headerName = folderName === null ? '__unassigned__' : folderName;
        const header = sourcesList.querySelector(`.enhancer-folder-header[data-folder-name="${headerName}"]`);
        if (!header) return;
        
        // Update LEFT custom selector
        const customFolderCb = header.querySelector('.enhancer-folder-selector');
        if (customFolderCb) {
            const customAssigned = [];
            items.forEach(item => {
                const id = item.dataset.id;
                const mappedName = notebookState.sourceMapping[id] || null;
                if (mappedName === folderName) {
                    const customCb = item.querySelector('.enhancer-custom-selector');
                    if (customCb) customAssigned.push(customCb);
                }
            });
            
            if (customAssigned.length === 0) {
                customFolderCb.checked = false;
                customFolderCb.indeterminate = false;
            } else {
                const checkedCount = customAssigned.filter(cb => cb.checked).length;
                customFolderCb.checked = checkedCount === customAssigned.length;
                customFolderCb.indeterminate = checkedCount > 0 && checkedCount < customAssigned.length;
            }
        }
    });
    
    syncFolderNativeCheckboxStates();
}

function syncFolderNativeCheckboxStates() {
    const sourcesList = LIVE_SOURCES_LIST_EL || document.querySelector(SELECTORS.SOURCES_LIST);
    if (!sourcesList) return;

    const items = sourcesList.querySelectorAll(SELECTORS.SOURCE_ITEM);
    const foldersToSync = [...notebookState.customFolders, null];

    foldersToSync.forEach(folderName => {
        const headerName = folderName === null ? '__unassigned__' : folderName;
        const header = sourcesList.querySelector(`.enhancer-folder-header[data-folder-name="${headerName}"]`);
        if (!header) return;
        
        // Update RIGHT native override folder toggle
        const nativeFolderCb = header.querySelector('.enhancer-folder-checkbox');
        if(nativeFolderCb) {
            const nativeAssigned = [];
            items.forEach(item => {
                const id = item.dataset.id;
                const mappedName = notebookState.sourceMapping[id] || null;
                if (mappedName === folderName) {
                    const cb = item.querySelector(SELECTORS.SOURCE_CHECKBOX);
                    if (cb) nativeAssigned.push(cb);
                }
            });
            
            if (nativeAssigned.length === 0) {
                nativeFolderCb.checked = false;
                nativeFolderCb.indeterminate = false;
                header.classList.remove('active');
            } else {
                const checkedCount = nativeAssigned.filter(cb => cb.checked).length;
                nativeFolderCb.checked = checkedCount === nativeAssigned.length;
                nativeFolderCb.indeterminate = checkedCount > 0 && checkedCount < nativeAssigned.length;
                
                if (checkedCount > 0) {
                    header.classList.add('active');
                } else {
                    header.classList.remove('active');
                }
            }
        }
    });
}

// ==========================================================================
// Bulk Actions Executions
// ==========================================================================
function getSelectedSourceIds() {
    const sourcesList = LIVE_SOURCES_LIST_EL || document.querySelector(SELECTORS.SOURCES_LIST);
    if (!sourcesList) return [];
    
    const ids = [];
    sourcesList.querySelectorAll('.enhancer-custom-selector:checked').forEach(cb => {
        const item = cb.closest('.enhancer-source-item');
        if (item && item.dataset.id) ids.push(item.dataset.id);
    });
    return ids;
}

function updateBulkActionBar() {
    const ids = getSelectedSourceIds();
    const bar = document.querySelector('.enhancer-bulk-action-bar');
    const sourcesList = LIVE_SOURCES_LIST_EL || document.querySelector(SELECTORS.SOURCES_LIST);
    
    if (bar) {
        if (ids.length > 0) {
            bar.classList.add('active');
            if (sourcesList) sourcesList.classList.add('selecting-mode');
        } else {
            bar.classList.remove('active');
            if (sourcesList) sourcesList.classList.remove('selecting-mode');
        }
    }
}

function handleBulkMoveToFolder(folderName) {
    const ids = getSelectedSourceIds();
    if (ids.length === 0) return;
    
    ids.forEach(id => {
        notebookState.sourceMapping[id] = folderName;
    });
    
    // Clear selections
    document.querySelectorAll('.enhancer-custom-selector, .enhancer-folder-selector').forEach(cb => cb.checked = false);
    
    saveState().then(() => {
        updateBulkActionBar();
        processSourceItems(LIVE_SOURCES_LIST_EL);
    });
}

function handleBulkMove(e) {
    e.stopPropagation();
    const btn = e.currentTarget;
    const parent = btn.parentElement;
    
    // Cleanup any existing menus
    document.querySelectorAll('.enhancer-bulk-folders-menu').forEach(el => el.remove());

    if(notebookState.customFolders.length === 0) {
        alert("Create a folder first!");
        return;
    }

    const menu = document.createElement('div');
    menu.className = 'enhancer-folder-menu-dropdown enhancer-bulk-folders-menu';
    menu.style.left = btn.offsetLeft + 'px';
    menu.style.top = (btn.offsetTop + btn.offsetHeight) + 'px';
    menu.style.right = 'auto';
    menu.style.minWidth = '180px';
    
    notebookState.customFolders.forEach(folderName => {
        const item = document.createElement('div');
        item.className = 'enhancer-submenu-item';
        item.textContent = folderName;
        item.onclick = (ev) => {
            ev.stopPropagation();
            menu.remove();
            handleBulkMoveToFolder(folderName);
        };
        menu.appendChild(item);
    });

    parent.appendChild(menu);

    setTimeout(() => {
        const closeMenu = (ev) => {
            if (!menu.contains(ev.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        document.addEventListener('click', closeMenu);
    }, 0);
}

function handleBulkUngroup(e) {
    const ids = getSelectedSourceIds();
    if(confirm(`Ungroup ${ids.length} selected sources?`)) {
        ids.forEach(id => {
             delete notebookState.sourceMapping[id];
        });
        document.querySelectorAll('.enhancer-custom-selector, .enhancer-folder-selector').forEach(cb => cb.checked = false);
        saveState().then(() => {
            updateBulkActionBar();
            processSourceItems(LIVE_SOURCES_LIST_EL);
        });
    }
}



// ==========================================================================
// Safe Drag-and-Drop (Data only, no DOM moving)
// ==========================================================================
let draggedSourceId = null;

function setupDragAndDrop() {
    document.addEventListener('dragstart', (e) => {
        const item = e.target.closest('.enhancer-source-item');
        if (!item) return;
        
        draggedSourceId = item.dataset.id;
        if (!draggedSourceId) return;

        e.dataTransfer.effectAllowed = 'move';
        item.classList.add('enhancer-dragging');
    });

    document.addEventListener('dragover', (e) => {
        if (!draggedSourceId) return;
        e.preventDefault(); // Necessary to allow dropping
        e.dataTransfer.dropEffect = 'move';
    });

    document.addEventListener('dragenter', (e) => {
        const dropzone = e.target.closest('.enhancer-folder-header');
        if(dropzone) {
            dropzone.classList.add('enhancer-drag-over');
        }
    });

    document.addEventListener('dragleave', (e) => {
        const dropzone = e.target.closest('.enhancer-folder-header');
        if(dropzone && !dropzone.contains(e.relatedTarget)) {
            dropzone.classList.remove('enhancer-drag-over');
        }
    });

    document.addEventListener('drop', async (e) => {
        if (!draggedSourceId) return;
        e.preventDefault();
        
        const dropzone = e.target.closest('.enhancer-folder-header');
        
        // Cleanup UI
        document.querySelectorAll('.enhancer-drag-over, .enhancer-dragging').forEach(el => {
            el.classList.remove('enhancer-drag-over', 'enhancer-dragging');
        });

        // If dropped onto a folder header
        if (dropzone) {
            const targetFolder = dropzone.dataset.folderName || null;
            const targetValue = targetFolder === '__unassigned__' ? null : targetFolder;
            
            // Determine the set of IDs to move
            let idsToMove = [draggedSourceId];
            
            // If the dragged item is selected, move all selected items
            const selectedIds = getSelectedSourceIds();
            if (selectedIds.includes(draggedSourceId)) {
                idsToMove = selectedIds;
            }
            
            let stateChanged = false;
            idsToMove.forEach(id => {
                if (targetValue === null) {
                    if (notebookState.sourceMapping[id]) {
                        console.log(`[Source Organizer] Moved ${id} to unassigned`);
                        delete notebookState.sourceMapping[id];
                        stateChanged = true;
                    }
                } else {
                    if (notebookState.sourceMapping[id] !== targetValue) {
                        console.log(`[Source Organizer] Moved ${id} to folder: ${targetFolder}`);
                        notebookState.sourceMapping[id] = targetValue;
                        stateChanged = true;
                    }
                }
            });
            
            if (stateChanged) {
                // Clear selections
                document.querySelectorAll('.enhancer-custom-selector, .enhancer-folder-selector').forEach(cb => cb.checked = false);
                saveState().then(() => {
                    updateBulkActionBar();
                    processSourceItems(LIVE_SOURCES_LIST_EL);
                });
            }
        }
        draggedSourceId = null;
    });
    
    document.addEventListener('dragend', () => {
        draggedSourceId = null;
        document.querySelectorAll('.enhancer-drag-over, .enhancer-dragging').forEach(el => {
            el.classList.remove('enhancer-drag-over', 'enhancer-dragging');
        });
    });
}

// Listen for native clicks anywhere near a checkbox and resync soon after
document.addEventListener('change', (e) => {
    if (e.target.matches(SELECTORS.SOURCE_CHECKBOX) || e.target.closest(SELECTORS.SOURCE_CHECKBOX)) {
        setTimeout(syncFolderCheckboxStates, 100);
    }
});

// Global click listeners for Native UI Interactions
document.addEventListener('click', (e) => {
    // 1. Check box syncs
    if (e.target.closest(SELECTORS.SOURCE_ITEM)) {
        setTimeout(syncFolderCheckboxStates, 100);
    }
    
    // 2. Intercept native 'More' button to inject our Folder Menu
    const moreBtn = e.target.closest('.source-item-more-button') || e.target.closest('button[aria-label="More"]') || e.target.closest('button[mattooltip="More"]');
    if (moreBtn && moreBtn.closest('.enhancer-source-item')) {
        // Yield to Angular to render the panel first
        setTimeout(() => augmentNativeMenu(moreBtn), 50);
    }
}, true);

// ==========================================================================
// Bootstrap
// ==========================================================================
async function init() {
    console.log('[Source Organizer] Bootstrapping...');
    const success = await initializeState();
    if (success) {
        discoverSelectors();
        setupObserver();
        setupDragAndDrop();
        enhanceSidebar();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
