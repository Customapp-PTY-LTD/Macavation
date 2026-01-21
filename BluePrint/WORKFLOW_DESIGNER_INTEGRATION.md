# Workflow Designer Integration Documentation

## Overview

The Workflow Designer is an interactive visual workflow builder integrated into the AutoFlows Admin Portal. It allows users to create, edit, and manage workflows through a drag-and-drop interface powered by jsPlumb Community Edition.

## Table of Contents

- [Architecture](#architecture)
- [Technologies](#technologies)
- [Key Features](#key-features)
- [Implementation Details](#implementation-details)
- [Data Structure](#data-structure)
- [API Reference](#api-reference)
- [Common Issues and Solutions](#common-issues-and-solutions)
- [Future Enhancements](#future-enhancements)

---

## Architecture

### Component Structure

```
Workflow Designer
├── Node Palette (Sidebar)
│   ├── Triggers (Start, WhatsApp, Email)
│   ├── AI Processing (AI Analysis, Image Recognition)
│   ├── Logic (Decision, Delay)
│   ├── Actions (Notification, Assignment)
│   └── End (Success, Error)
├── Canvas (Main Area)
│   ├── Toolbar (Undo, Redo, Auto Layout, Validate, Test, Save)
│   ├── Workflow Canvas (jsPlumb container)
│   └── Zoom Controls
└── Properties Panel (Right Sidebar)
```

### File Structure

- **Main Implementation**: `/admin-portal/assets/js/app.js`
  - `loadWorkflowDesigner()` - Initializes the designer UI
  - `initializeJsPlumb()` - Sets up jsPlumb instance
  - `setupJsPlumbNodes()` - Configures nodes for connections
  - `loadWorkflowIntoCanvas()` - Loads saved workflow data
  - `renderConnections()` - Renders connections between nodes
  - `collectWorkflowDefinition()` - Collects workflow data for saving
  - `saveWorkflow()` - Persists workflow to database

- **Styling**: 
  - `/admin-portal/assets/css/main.css` - Core styles
  - `/admin-portal/assets/css/workflow-designer.css` - Designer-specific styles

- **Navigation**: `/admin-portal/modules/workflows/js/workflows_list.js`
  - `editWorkflow(id)` - Navigates to designer with workflow ID

---

## Technologies

### Core Libraries

1. **jsPlumb Community Edition 2.15.6**
   - Visual workflow/flowchart library
   - Handles node connections, drag-and-drop, and visual rendering
   - API: `jsPlumb.getInstance()`, `jsPlumb.draggable()`, `jsPlumb.connect()`

2. **Bootstrap 5**
   - UI components and styling framework
   - Modal dialogs, buttons, tooltips

3. **Supabase**
   - Backend database (PostgreSQL)
   - Stores workflow definitions as JSONB
   - Client: `_dataFunctions.updateWorkflow()`

4. **SweetAlert2**
   - User feedback dialogs
   - Confirmation modals

5. **Vanilla JavaScript (ES6+)**
   - No framework dependencies
   - DOM manipulation, event handling
   - Async/await for API calls

---

## Key Features

### 1. Drag-and-Drop Node Creation

- **Source**: Node palette sidebar items
- **Target**: Workflow canvas
- **Implementation**: HTML5 Drag and Drop API
- **Node Types**: Triggers, AI Processing, Logic, Actions, End nodes

### 2. Inline Text Editing

- **Editable Fields**: Node name and description
- **Implementation**: HTML `contenteditable="true"` attribute
- **Features**:
  - Click to edit
  - Enter to save
  - Escape to cancel
  - Visual focus indicators
  - Prevents dragging while editing

### 3. Visual Node Connections

- **Connection Method**: Drag from source endpoint to target endpoint
- **Endpoints**: 
  - Right side (source/output) - blue dot
  - Left side (target/input) - blue dot
- **Visual Style**: Flowchart connector with rounded corners
- **Validation**: Prevents invalid connections

### 4. Workflow Persistence

- **Save**: Collects all node data and connections
- **Load**: Reconstructs workflow from saved definition
- **Storage**: Supabase `workflows` table, `definition` JSONB column
- **Format**: JSON structure with `nodes` and `connections` arrays

### 5. Node Management

- **Delete**: Click delete button on node
- **Drag**: Move nodes around canvas
- **Position**: Saved as `x`, `y` coordinates
- **Grid**: Snaps to 20x20 pixel grid

---

## Implementation Details

### Initialization Flow

```javascript
1. loadWorkflowDesigner(params)
   ├── Fetch workflow data (if workflowId provided)
   ├── Render HTML structure
   ├── Setup save button handler
   ├── Initialize drag-and-drop
   └── Load workflow into canvas (if data exists)

2. initializeJsPlumb()
   ├── Clean up existing connections/endpoints
   ├── Create jsPlumb instance with configuration
   └── Set container to workflow canvas

3. setupJsPlumbNodes()
   ├── Iterate all .workflow-node elements
   ├── Remove existing endpoints (prevent duplicates)
   ├── Make nodes draggable
   └── Add source (Right) and target (Left) endpoints

4. loadWorkflowIntoCanvas(workflowData)
   ├── Clear existing nodes
   ├── Create nodes from definition.nodes
   ├── Setup jsPlumb for new nodes
   └── Render connections from definition.connections
```

### Node Creation

```javascript
createWorkflowNode(nodeType, nodeId, position, nodeData)
├── Validate nodeId (prevent reserved words)
├── Create DOM element with structure:
│   ├── .workflow-node (container)
│   ├── .node-icon (visual indicator)
│   ├── .node-name (editable)
│   ├── .node-desc (editable)
│   └── .btn-delete-node (delete button)
├── Set position (x, y)
├── Store metadata in data attributes
├── Setup inline editing
└── Return node element
```

### Connection Handling

#### Creating Connections

```javascript
renderConnections(connections)
├── Wait for endpoints to be ready (retry logic)
├── For each connection:
│   ├── Normalize source/target IDs
│   ├── Find source and target nodes
│   ├── Get/create endpoints
│   ├── Match endpoints (UUID, ID, or anchor fallback)
│   └── Connect using endpoint objects
└── Log success/failure
```

#### Endpoint Matching Strategy

The system uses a multi-tier matching approach to handle UUID inconsistencies:

1. **Exact UUID Match**: `ep.uuid === expectedUuid`
2. **ID Match**: `ep.id === expectedUuid` (some jsPlumb versions)
3. **Anchor + Direction Match**: Match by anchor name and `isSource`/`isTarget`
4. **Fallback**: Use any endpoint with correct direction

#### Connection Methods

```javascript
// Method 1: Endpoint objects (preferred)
jp.connect({ source: sourceEp, target: targetEp })

// Method 2: Element + anchor (fallback)
jp.connect({ 
    source: sourceNode, 
    target: targetNode, 
    anchors: ['Right', 'Left'] 
})

// Method 3: UUID strings (last resort)
jp.connect({ 
    source: sourceEndpointUuid, 
    target: targetEndpointUuid 
})
```

### Saving Workflow

```javascript
saveWorkflow(workflowId)
├── Show loading state
├── Collect workflow definition:
│   ├── Iterate all .workflow-node elements
│   ├── Extract node data (id, type, name, description, position)
│   ├── Get connections from jsPlumb
│   ├── Normalize node IDs
│   └── Filter invalid connections
├── Prepare update data
├── Call _dataFunctions.updateWorkflow()
└── Show success/error feedback
```

### Inline Editing

```javascript
setupNodeEditing(nodeElement, nodeId)
├── Add contenteditable="true" to .node-name and .node-desc
├── Focus event:
│   ├── Select all text
│   ├── Add 'editing' class
│   └── Store original value
├── Blur event:
│   ├── Save changes to dataset.nodeData
│   ├── Remove 'editing' class
│   └── Update node data
├── Keydown event:
│   ├── Enter: blur (save)
│   └── Escape: revert and blur
└── Mousedown event: prevent drag when clicking text
```

---

## Data Structure

### Workflow Definition (JSONB)

```json
{
  "nodes": [
    {
      "id": "start",
      "type": "start",
      "name": "Start",
      "description": "Manual trigger",
      "position": {
        "x": 100,
        "y": 200
      }
    },
    {
      "id": "node-1234567890-abc123",
      "type": "ai-analysis",
      "name": "AI Analysis",
      "description": "Claude 3.5 Sonnet",
      "position": {
        "x": 300,
        "y": 200
      }
    }
  ],
  "connections": [
    {
      "source": "start",
      "target": "node-1234567890-abc123"
    }
  ]
}
```

### Node ID Generation

- **Format**: `node-{timestamp}-{randomString}`
- **Example**: `node-1768905763187-k1g14rda3`
- **Validation**: 
  - Cannot be reserved words: `document`, `window`, `body`, `canvas`, etc.
  - Cannot start with `workflow-node-` (reserved prefix)
  - Must be unique within workflow

### Endpoint UUIDs

- **Format**: `{nodeId}-right` or `{nodeId}-left`
- **Example**: `start-right`, `node-123-left`
- **Note**: jsPlumb may generate different UUIDs, so matching uses fallback strategies

---

## API Reference

### Main Methods

#### `loadWorkflowDesigner(params)`

Initializes the workflow designer interface.

**Parameters:**
- `params.id` or `params.workflowId` (string, optional): Workflow ID to edit

**Returns:** `Promise<void>`

**Example:**
```javascript
await AdminApp.loadWorkflowDesigner({ id: 'workflow-123' });
```

#### `initializeJsPlumb()`

Creates and configures the jsPlumb instance.

**Configuration:**
- PaintStyle: Blue stroke, 2px width
- Connector: Flowchart with rounded corners
- Endpoint: Dot, 6px radius
- Anchors: Right (source), Left (target)

**Returns:** `void`

#### `setupJsPlumbNodes()`

Configures all workflow nodes for jsPlumb connections.

**Actions:**
- Removes existing endpoints (prevents duplicates)
- Makes nodes draggable
- Adds source and target endpoints

**Returns:** `void`

#### `loadWorkflowIntoCanvas(workflowData)`

Loads a saved workflow into the canvas.

**Parameters:**
- `workflowData` (object): Workflow object with `definition` property

**Returns:** `void`

#### `renderConnections(connections)`

Renders connections between nodes.

**Parameters:**
- `connections` (array): Array of connection objects with `source` and `target`

**Returns:** `void`

**Connection Object Format:**
```javascript
{
  source: "node-id-1",
  target: "node-id-2"
}
```

#### `collectWorkflowDefinition()`

Collects current workflow state for saving.

**Returns:** `object` - Workflow definition with `nodes` and `connections`

**Example Output:**
```javascript
{
  nodes: [
    { id: "start", type: "start", name: "Start", ... },
    { id: "node-123", type: "ai-analysis", name: "AI Analysis", ... }
  ],
  connections: [
    { source: "start", target: "node-123" }
  ]
}
```

#### `saveWorkflow(workflowId)`

Saves the current workflow to the database.

**Parameters:**
- `workflowId` (string): Workflow ID to update

**Returns:** `Promise<void>`

**Example:**
```javascript
await AdminApp.saveWorkflow('workflow-123');
```

### Helper Functions

#### `extractNodeId(endpointOrElement)`

Extracts node ID from various jsPlumb objects.

**Parameters:**
- `endpointOrElement` (string|object): UUID string, endpoint object, or DOM element

**Returns:** `string|null` - Node ID or null if invalid

**Example:**
```javascript
const nodeId = extractNodeId('start-right'); // Returns: 'start'
const nodeId = extractNodeId(endpointObject); // Returns: 'node-123'
```

#### `createWorkflowNode(nodeType, nodeId, position, nodeData)`

Creates a workflow node DOM element.

**Parameters:**
- `nodeType` (string): Node type (e.g., 'start', 'ai-analysis')
- `nodeId` (string): Unique node identifier
- `position` (object): `{ x: number, y: number }`
- `nodeData` (object, optional): Additional node data

**Returns:** `HTMLElement` - Node DOM element

#### `setupNodeEditing(nodeElement, nodeId)`

Enables inline editing for a node.

**Parameters:**
- `nodeElement` (HTMLElement): Node DOM element
- `nodeId` (string): Node identifier

**Returns:** `void`

---

## Common Issues and Solutions

### Issue: "Source endpoint not found"

**Symptoms:** Console error when rendering connections, endpoints exist but UUID doesn't match.

**Cause:** jsPlumb generates different UUIDs than expected, or endpoint matching fails.

**Solution:** 
- Enhanced endpoint matching with multiple fallback strategies
- Match by UUID, ID, anchor name, or direction
- Use any endpoint with correct direction as final fallback

**Code Location:** `renderConnections()` in `app.js` (lines ~2069-2095)

### Issue: "Failed to create connection"

**Symptoms:** Connection fails even though endpoints exist.

**Cause:** Incorrect `jsPlumb.connect()` parameters or API usage.

**Solution:**
- Use endpoint objects directly: `jp.connect({ source: sourceEp, target: targetEp })`
- Fallback to element + anchor method
- Fallback to UUID strings
- Enhanced error logging for debugging

**Code Location:** `renderConnections()` in `app.js` (lines ~2120-2150)

### Issue: "Invalid node ID: document"

**Symptoms:** Node ID is a reserved word like "document" or "window".

**Cause:** Node ID generation or extraction produces invalid IDs.

**Solution:**
- Validate node IDs against reserved words list
- Regenerate IDs if invalid
- Filter out invalid IDs during connection collection

**Code Location:** 
- `createWorkflowNode()` - validates during creation
- `extractNodeId()` - filters reserved words
- `collectWorkflowDefinition()` - validates before saving

### Issue: Save button not working

**Symptoms:** Clicking save button does nothing.

**Cause:** z-index, pointer-events, or event listener issues.

**Solution:**
- Explicit CSS: `pointer-events: auto`, `z-index: 1002`
- Clone and replace button to remove duplicate listeners
- Retry logic if button not found immediately

**Code Location:** 
- `setupSaveButton()` and `attachSaveHandler()` in `app.js`
- CSS in `main.css` (`.workflow-canvas-toolbar #btnSaveWorkflow`)

### Issue: Connections not saving

**Symptoms:** Connections created but not persisted.

**Cause:** Connection collection logic not extracting correct node IDs.

**Solution:**
- Use `jsPlumbInstance.getConnections()` to get all connections
- Extract node IDs using `extractNodeId()` helper
- Normalize IDs (remove prefixes/suffixes)
- Filter duplicates and invalid connections

**Code Location:** `collectWorkflowDefinition()` in `app.js` (lines ~1190-1350)

### Issue: Cannot connect nodes after reload

**Symptoms:** After loading saved workflow, cannot create new connections.

**Cause:** jsPlumb endpoints not properly re-initialized.

**Solution:**
- Clean up existing connections/endpoints before initialization
- Call `setupJsPlumbNodes()` after loading nodes
- Use longer timeouts to ensure DOM readiness
- Check endpoints are ready before rendering connections

**Code Location:** 
- `loadWorkflowIntoCanvas()` - cleanup and initialization
- `renderConnections()` - endpoints ready check

---

## Future Enhancements

### Planned Features

1. **Undo/Redo Functionality**
   - Track workflow state changes
   - Implement command pattern for operations
   - Keyboard shortcuts (Ctrl+Z, Ctrl+Y)

2. **Auto Layout**
   - Automatic node positioning algorithms
   - Hierarchical layout for workflows
   - Force-directed graph layout

3. **Workflow Validation**
   - Check for orphaned nodes
   - Validate required connections
   - Detect circular dependencies
   - Validate node configurations

4. **Workflow Testing**
   - Test workflow execution
   - Step-through debugging
   - Mock data injection
   - Execution visualization

5. **Node Properties Panel**
   - Configure node-specific settings
   - Conditional logic builder
   - Data mapping interface
   - Custom field definitions

6. **Workflow Templates**
   - Pre-built workflow templates
   - Save as template
   - Template marketplace

7. **Collaboration Features**
   - Real-time collaborative editing
   - Comments on nodes
   - Version history
   - Change tracking

8. **Export/Import**
   - Export to JSON
   - Import from JSON
   - Export to image (PNG/SVG)
   - Print workflow

### Technical Improvements

1. **Performance Optimization**
   - Virtual scrolling for large workflows
   - Lazy loading of node types
   - Debounce connection rendering
   - Optimize DOM updates

2. **Accessibility**
   - Keyboard navigation
   - Screen reader support
   - ARIA labels
   - Focus management

3. **Mobile Support**
   - Touch gestures
   - Responsive layout
   - Mobile-optimized UI
   - Touch-friendly controls

4. **Error Handling**
   - Better error messages
   - Error recovery
   - Validation feedback
   - User-friendly error dialogs

---

## Troubleshooting Guide

### Debug Mode

Enable detailed logging by checking browser console. Key log points:

1. **Initialization**: `jsPlumb initialized and configured`
2. **Node Setup**: `Found X nodes to setup`
3. **Connection Rendering**: `Rendered connection X: source -> target`
4. **Endpoint Matching**: `Available endpoints for connection X`
5. **Save Process**: `Collected X nodes and Y connections`

### Common Debugging Steps

1. **Check jsPlumb Instance**
   ```javascript
   console.log(AdminApp.jsPlumbInstance);
   ```

2. **Inspect Endpoints**
   ```javascript
   const node = document.querySelector('.workflow-node');
   const endpoints = AdminApp.jsPlumbInstance.getEndpoints(node);
   console.log(endpoints);
   ```

3. **Check Connections**
   ```javascript
   const connections = AdminApp.jsPlumbInstance.getConnections();
   console.log(connections);
   ```

4. **Verify Workflow Definition**
   ```javascript
   const definition = AdminApp.collectWorkflowDefinition();
   console.log(definition);
   ```

### Browser Compatibility

- **Chrome/Edge**: ✅ Fully supported
- **Firefox**: ✅ Fully supported
- **Safari**: ✅ Fully supported
- **IE11**: ❌ Not supported (jsPlumb 2.x requires modern browser)

---

## Contributing

When modifying the workflow designer:

1. **Test thoroughly** - Test all node types, connections, save/load
2. **Check console** - Ensure no errors or warnings
3. **Validate data** - Verify workflow definition structure
4. **Update documentation** - Keep this file current
5. **Consider edge cases** - Empty workflows, single nodes, complex connections

---

## License

This integration is part of the AutoFlows Admin Portal project.

---

**Last Updated:** January 2025  
**Version:** 1.0.0  
**Author:** AutoFlows Development Team
