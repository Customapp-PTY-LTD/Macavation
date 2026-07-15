import { GUIDE_TO_APP_ROUTE } from './user-guide-screenshot-routes';
import type { CaptureAction } from './user-guide-capture.helper';

/** Per-topic capture overrides (grid / CRM tab / modal). */
export const CAPTURE_OVERRIDES: Record<string, CaptureAction> = {
  'supply-chain-flow': { route: '', kind: 'svg-only', skip: 'Embedded SVG only' },

  'crm-nis-suppliers': { route: 'crm-grid', kind: 'crm-tab', tabSelector: '#nis-suppliers-tab' },
  'crm-oil-processors': { route: 'crm-grid', kind: 'crm-tab', tabSelector: '#oil-processors-tab' },
  'crm-oil-ingredient-suppliers': {
    route: 'crm-grid',
    kind: 'crm-tab',
    tabSelector: '#oil-ingredient-suppliers-tab',
  },
  'crm-oil-protein-customers': {
    route: 'crm-grid',
    kind: 'crm-tab',
    tabSelector: '#oil-protein-customers-tab',
  },
  'crm-kernel-customers': { route: 'crm-grid', kind: 'crm-tab', tabSelector: '#kernel-customers-tab' },

  'modal-crm-contact': {
    route: 'crm-grid',
    kind: 'modal',
    openSelector: '#addContactBtn',
    modalSelector: '#contactModal',
  },
  'modal-user': {
    route: 'users-grid',
    kind: 'modal',
    openSelector: '#addUserBtn',
    modalSelector: '#userModal',
  },
  'modal-role': {
    route: 'roles-grid',
    kind: 'modal',
    openSelector: '#addRoleBtn',
    modalSelector: '#roleModal',
  },
  'modal-admin-add-user': {
    route: 'admin-grid',
    kind: 'modal',
    openSelector: '[data-bs-target="#addUserModal"], #adminBtnAddUser, #adminBtnAddUserTab',
    modalSelector: '#addUserModal',
  },
  'modal-admin-add-role': {
    route: 'admin-grid',
    kind: 'modal',
    adminTab: 'roles',
    openSelector: '[data-bs-target="#addRoleModal"]',
    modalSelector: '#addRoleModal',
  },
  'modal-feature': {
    route: 'features-grid',
    kind: 'modal',
    openSelector: '#addFeatureBtn',
    modalSelector: '#featureModal',
  },
  'modal-quality-test': {
    route: 'quality-assurance-grid',
    kind: 'modal',
    openSelector: '#addTestBtn',
    modalSelector: '#qualityTestModal',
  },
  'modal-grower-create-kernel-batch': {
    route: 'grower-intake-grid',
    kind: 'modal',
    openSelector: '#createKernelBatchBtn',
    modalSelector: '#createKernelBatchModal',
  },
  'modal-send-to-dispatch': {
    route: 'stock-management-kernel',
    kind: 'modal',
    openSelector: '#sendToDispatchBtn',
    modalSelector: '#sendToDispatchModal',
  },
  'modal-send-to-dispatch-oil': {
    route: 'stock-management-oil',
    kind: 'modal',
    openSelector: '#sendToDispatchOilBtn',
    modalSelector: '#sendToDispatchOilModal',
  },
  'modal-import-oil-lots': {
    route: 'stock-management-oil',
    kind: 'modal',
    openSelector: '#importOilLotsBtn',
    modalSelector: '#importOilLotsModal',
  },
  'modal-oil-lot': {
    route: 'stock-management-oil',
    kind: 'modal',
    openSelector: '#addOilLotBtn',
    modalSelector: '#oilLotModal',
  },
  'modal-role-permission': {
    route: 'role-permissions-grid',
    kind: 'modal',
    openSelector: '#addPermissionBtn',
    modalSelector: '#permissionModal',
  },
  'modal-supplier-receiver-checklist': {
    route: 'supplier-intake-grid',
    kind: 'modal',
    openSelector: '#supplierReceiverChecklistBtn',
    modalSelector: '#supplierReceiverChecklistModal',
  },
  'modal-grower-receiving-checklist': {
    route: 'grower-intake-grid',
    kind: 'modal',
    openSelector: '.js-intake-checklist-btn',
    modalSelector: '#growerReceivingChecklistModal',
  },
  'modal-production-stages': {
    route: 'kernel-production-grid',
    kind: 'modal',
    openSelector: '.js-production-batch',
    modalSelector: '#productionStagesModal',
  },
  'modal-kernel-job-card': {
    route: 'kernel-production-grid',
    kind: 'modal',
    openSelector: '.js-job-card-batch',
    modalSelector: '#kernelJobCardModal',
  },
  'modal-batch-history': {
    route: 'kernel-production-grid',
    kind: 'modal',
    openSelector: '.js-batch-history',
    modalSelector: '#batchHistoryModal',
  },
  'modal-batch-summary': {
    route: 'kernel-production-grid',
    kind: 'modal',
    openSelector: '.js-batch-summary, #batchSummaryBtn',
    modalSelector: '#batchSummaryModal',
  },
  'modal-end-sample': {
    route: 'kernel-production-grid',
    kind: 'modal',
    prepareRoute: 'kernel-production-grid',
    openSelector: '.js-end-sample-batch',
    modalSelector: '#endSampleModal',
  },
  'modal-end-sample-view': {
    route: 'kernel-production-grid',
    kind: 'modal',
    prepareRoute: 'kernel-production-grid',
    openSelector: '.js-end-sample-batch',
    modalSelector: '#endSampleViewModal',
  },
  'modal-kernel-dispatch-form': {
    route: 'kernel-dispatch-grid',
    kind: 'modal',
    openSelector: '.js-view-dispatch-order',
    modalSelector: '#kernelDispatchFormModal',
  },
  'modal-oil-dispatch-form': {
    route: 'oil-dispatch-grid',
    kind: 'modal',
    openSelector: '.js-view-oil-dispatch-order',
    modalSelector: '#oilDispatchFormModal',
  },

  'modal-role-feature': {
    route: 'role-features-grid',
    kind: 'grid',
    skip: 'No modal — checkbox grid; using module screenshot',
  },
  'modal-stock-take': {
    route: 'stock-management-kernel',
    kind: 'modal',
    openSelector: '#stockTakeBtn',
    modalSelector: '#stockTakeModal',
    skip: 'stockTakeBtn may be absent in deployment',
  },
  'modal-receiving-checklist': {
    route: 'stock-management-kernel',
    kind: 'modal',
    openSelector: '#receivingChecklistBtn',
    modalSelector: '#receivingChecklistModal',
    skip: 'receivingChecklistBtn may be absent on kernel stock toolbar',
  },
  'modal-supplier-oil-batch': {
    route: 'supplier-intake-grid',
    kind: 'modal',
    openSelector: '.js-supplier-intake-edit',
    modalSelector: '#supplierOilBatchModal',
  },
  'modal-grower-link-sample-to-batch': {
    route: 'grower-intake-grid',
    kind: 'modal',
    openSelector: '.js-intake-sample-btn',
    modalSelector: '#linkSampleToBatchModal',
  },
  'modal-kernel-dispatch': {
    route: 'kernel-dispatch-grid',
    kind: 'grid',
    skip: 'Basket modal opened programmatically; use dispatch form topic',
  },
  'modal-oil-dispatch': {
    route: 'oil-dispatch-grid',
    kind: 'grid',
    skip: 'Basket modal opened programmatically; use oil dispatch form topic',
  },
  'modal-job-card-view': {
    route: 'kernel-production-grid',
    kind: 'modal',
    openSelector: '.js-job-card-batch',
    modalSelector: '#jobCardViewModal',
  },
  'modal-production-stages-view': {
    route: 'kernel-production-grid',
    kind: 'modal',
    openSelector: '.js-production-batch',
    modalSelector: '#productionStagesViewModal',
  },
  'modal-oil-production-sheet': {
    route: 'oil-production-grid',
    kind: 'modal',
    openSelector: '.op-production-sheet-btn',
    modalSelector: '#opProductionSheetModal',
  },
  'modal-raw-material-issued': {
    route: 'oil-production-grid',
    kind: 'modal',
    openSelector: '#rawMaterialIssuedBtn',
    modalSelector: '#rawMaterialIssuedModal',
  },
};

export function getCaptureAction(guideId: string): CaptureAction | null {
  if (CAPTURE_OVERRIDES[guideId]) return CAPTURE_OVERRIDES[guideId];
  const route = GUIDE_TO_APP_ROUTE[guideId];
  if (route == null) return null;
  if (guideId.startsWith('modal-')) {
    return { route, kind: 'modal', skip: 'No capture recipe — falls back to grid' };
  }
  return { route, kind: 'grid' };
}

/** Guide ids that need their own PNG (not copied from route batch). */
export function getTopicCaptureIds(): string[] {
  return Object.keys(GUIDE_TO_APP_ROUTE).filter((id) => {
    const route = GUIDE_TO_APP_ROUTE[id];
    if (route == null) return false;
    const action = getCaptureAction(id);
    if (!action || action.kind === 'svg-only') return false;
    if (action.kind === 'grid' && !CAPTURE_OVERRIDES[id]) return false;
    return true;
  });
}

/** Unique routes for grid-only batch capture. */
export function getGridCaptureRoutes(): string[] {
  const routes = new Set<string>();
  for (const [id, route] of Object.entries(GUIDE_TO_APP_ROUTE)) {
    if (route == null) continue;
    const action = getCaptureAction(id);
    if (!action || action.kind === 'svg-only') continue;
    if (action.kind === 'grid' && !CAPTURE_OVERRIDES[id]) {
      routes.add(route);
    }
  }
  return [...routes];
}

/** Guide ids that should receive a copy of a route grid screenshot. */
export function getGuideIdsForRoute(route: string): string[] {
  return Object.entries(GUIDE_TO_APP_ROUTE)
    .filter(([id, r]) => {
      if (r !== route) return false;
      const action = getCaptureAction(id);
      return action?.kind === 'grid' && !CAPTURE_OVERRIDES[id];
    })
    .map(([id]) => id);
}
