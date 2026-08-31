/**
 * @file appointmentResourceRepository.ts
 * @description Cloudflare D1 Appointment Resource Repository
 * 
 * ============================================================================
 * ARCHITECTURAL MANDATES:
 * 1. Strict tenant & business isolation: WHERE id = ? AND organization_id = ? AND business_id = ?
 * 2. Canonical server-side resource resolution for appointments.
 * 3. Enforce resource availability status ('active' vs 'maintenance' / 'offline').
 * 4. Zero cross-tenant or cross-business existence disclosure.
 * ============================================================================
 */

import { isValidIsoWithTimezone } from '../utils/rfc3339Validator';

export type AppointmentResourceType = 'staff' | 'room' | 'chair' | 'vehicle_bay' | 'table';
export type AppointmentResourceStatus = 'active' | 'maintenance' | 'offline';

const VALID_RESOURCE_TYPES = new Set<string>(['staff', 'room', 'chair', 'vehicle_bay', 'table']);
const VALID_RESOURCE_STATUSES = new Set<string>(['active', 'maintenance', 'offline']);

export function isValidResourceType(type: unknown): type is AppointmentResourceType {
  return typeof type === 'string' && VALID_RESOURCE_TYPES.has(type);
}

export function isValidResourceStatus(status: unknown): status is AppointmentResourceStatus {
  return typeof status === 'string' && VALID_RESOURCE_STATUSES.has(status);
}

export interface AppointmentResource {
  id: string;
  organizationId: string;
  businessId: string;
  name: string;
  resourceType: AppointmentResourceType;
  capacityUnits: number;
  status: AppointmentResourceStatus;
  createdAt: string;
}

export class AppointmentResourceRepository {
  private static assertDbOrDev(db: D1Database | undefined, environment: string = 'production'): void {
    if (!db) {
      const isDevOrTest = environment === 'development' || environment === 'test';
      if (!isDevOrTest) {
        throw new Error('APPOINTMENT_RESOURCE_LOOKUP_FAILED');
      }
    }
  }

  private static memResources: AppointmentResource[] = [
    {
      id: 'stf_01',
      organizationId: 'org_apex_holding',
      businessId: 'biz_beauty_salon',
      name: 'Elena Rostova (Master Esthetician)',
      resourceType: 'staff',
      capacityUnits: 1,
      status: 'active',
      createdAt: '2026-08-20T00:00:00Z',
    },
    {
      id: 'stf_02',
      organizationId: 'org_apex_holding',
      businessId: 'biz_beauty_salon',
      name: 'Dr. Aris Thorne',
      resourceType: 'staff',
      capacityUnits: 1,
      status: 'active',
      createdAt: '2026-08-20T00:00:00Z',
    },
    {
      id: 'res_master_01',
      organizationId: 'org_apex_holding',
      businessId: 'biz_beauty_salon',
      name: 'Master Stylist',
      resourceType: 'staff',
      capacityUnits: 1,
      status: 'active',
      createdAt: '2026-08-20T00:00:00Z',
    },
    {
      id: 'res_elena_01',
      organizationId: 'org_apex_holding',
      businessId: 'biz_beauty_salon',
      name: 'Elena Rostova',
      resourceType: 'staff',
      capacityUnits: 1,
      status: 'active',
      createdAt: '2026-08-20T00:00:00Z',
    },
    {
      id: 'stf_01',
      organizationId: 'org_alpha_holdings',
      businessId: 'biz_beauty_salon',
      name: 'Elena Rostova',
      resourceType: 'staff',
      capacityUnits: 1,
      status: 'active',
      createdAt: '2026-08-20T00:00:00Z',
    },
    {
      id: 'stf_offline_01',
      organizationId: 'org_apex_holding',
      businessId: 'biz_beauty_salon',
      name: 'Staff Under Maintenance',
      resourceType: 'staff',
      capacityUnits: 1,
      status: 'maintenance',
      createdAt: '2026-08-20T00:00:00Z',
    },
    {
      id: 'stf_dental_01',
      organizationId: 'org_apex_holding',
      businessId: 'biz_dental_clinic',
      name: 'Dr. Marcus Webb',
      resourceType: 'staff',
      capacityUnits: 1,
      status: 'active',
      createdAt: '2026-08-20T00:00:00Z',
    },
    {
      id: 'res_dr_selin',
      organizationId: 'org_demo',
      businessId: 'biz_aura',
      name: 'Dr. Selin Arslan',
      resourceType: 'staff',
      capacityUnits: 1,
      status: 'active',
      createdAt: '2026-08-20T00:00:00Z',
    },
    {
      id: 'res_stylist_cem',
      organizationId: 'org_demo',
      businessId: 'biz_aura',
      name: 'Cem Kaya',
      resourceType: 'staff',
      capacityUnits: 1,
      status: 'active',
      createdAt: '2026-08-20T00:00:00Z',
    },
    {
      id: 'res_laser_room_1',
      organizationId: 'org_demo',
      businessId: 'biz_aura',
      name: 'Laser Suite #1',
      resourceType: 'room',
      capacityUnits: 1,
      status: 'active',
      createdAt: '2026-08-20T00:00:00Z',
    },
    {
      id: 'res_tbl_waterfront',
      organizationId: 'org_demo',
      businessId: 'biz_palas',
      name: 'Waterfront Terrace',
      resourceType: 'table',
      capacityUnits: 6,
      status: 'active',
      createdAt: '2026-08-20T00:00:00Z',
    },
    {
      id: 'res_tbl_private_room',
      organizationId: 'org_demo',
      businessId: 'biz_palas',
      name: 'Executive Private Suite',
      resourceType: 'room',
      capacityUnits: 10,
      status: 'active',
      createdAt: '2026-08-20T00:00:00Z',
    },
    {
      id: 'res_rep_marcus',
      organizationId: 'org_demo',
      businessId: 'biz_auto',
      name: 'Marcus Vance',
      resourceType: 'staff',
      capacityUnits: 1,
      status: 'active',
      createdAt: '2026-08-20T00:00:00Z',
    },
    {
      id: 'res_rep_elena',
      organizationId: 'org_demo',
      businessId: 'biz_auto',
      name: 'Elena Rostova',
      resourceType: 'staff',
      capacityUnits: 1,
      status: 'active',
      createdAt: '2026-08-20T00:00:00Z',
    },
  ];

  public static registerTestResource(resource: AppointmentResource): void {
    if (
      !resource ||
      typeof resource !== 'object' ||
      !resource.id || typeof resource.id !== 'string' || resource.id.trim().length === 0 ||
      !resource.organizationId || typeof resource.organizationId !== 'string' || resource.organizationId.trim().length === 0 ||
      !resource.businessId || typeof resource.businessId !== 'string' || resource.businessId.trim().length === 0 ||
      !resource.name || typeof resource.name !== 'string' || resource.name.trim().length === 0 ||
      !isValidResourceType(resource.resourceType) ||
      typeof resource.capacityUnits !== 'number' || !Number.isSafeInteger(resource.capacityUnits) || resource.capacityUnits <= 0 ||
      !isValidResourceStatus(resource.status) ||
      !resource.createdAt || typeof resource.createdAt !== 'string' || !isValidIsoWithTimezone(resource.createdAt)
    ) {
      throw new Error('TEST_RESOURCE_INVALID');
    }

    const idx = AppointmentResourceRepository.memResources.findIndex(
      r => r.id === resource.id && r.organizationId === resource.organizationId && r.businessId === resource.businessId
    );
    if (idx >= 0) {
      AppointmentResourceRepository.memResources[idx] = resource;
    } else {
      AppointmentResourceRepository.memResources.push(resource);
    }
  }

  public static async getByIdForBusiness(
    db: D1Database | undefined,
    resourceId: string,
    organizationId: string,
    businessId: string,
    environment: string = 'production'
  ): Promise<AppointmentResource | null> {
    AppointmentResourceRepository.assertDbOrDev(db, environment);

    if (!resourceId || typeof resourceId !== 'string' || resourceId.trim().length === 0 || !organizationId || !businessId) {
      return null;
    }

    if (db) {
      try {
        const row = await db.prepare(`
          SELECT id, organization_id, business_id, name, resource_type, capacity_units, status, created_at
          FROM appointment_resources
          WHERE id = ? AND organization_id = ? AND business_id = ?
        `).bind(resourceId.trim(), organizationId, businessId).first<{
          id: string;
          organization_id: string;
          business_id: string;
          name: string;
          resource_type: string;
          capacity_units: number;
          status: string;
          created_at: string;
        }>();

        if (!row) return null;

        // Strict runtime validation of canonical resource row
        if (
          !row.id || typeof row.id !== 'string' || row.id.trim().length === 0 ||
          row.organization_id !== organizationId ||
          row.business_id !== businessId ||
          !row.name || typeof row.name !== 'string' || row.name.trim().length === 0 || row.name.length > 256 ||
          !isValidResourceType(row.resource_type) ||
          !isValidResourceStatus(row.status) ||
          typeof row.capacity_units !== 'number' || !Number.isSafeInteger(row.capacity_units) || row.capacity_units <= 0 ||
          !row.created_at || typeof row.created_at !== 'string' || !isValidIsoWithTimezone(row.created_at)
        ) {
          throw new Error('APPOINTMENT_RESOURCE_LOOKUP_FAILED');
        }

        return {
          id: row.id,
          organizationId: row.organization_id,
          businessId: row.business_id,
          name: row.name,
          resourceType: row.resource_type,
          capacityUnits: row.capacity_units,
          status: row.status,
          createdAt: row.created_at,
        };
      } catch (err: any) {
        if (err?.message === 'APPOINTMENT_RESOURCE_LOOKUP_FAILED') {
          throw err;
        }
        throw new Error('APPOINTMENT_RESOURCE_LOOKUP_FAILED');
      }
    }

    const found = AppointmentResourceRepository.memResources.find(
      r => r.id === resourceId && r.organizationId === organizationId && r.businessId === businessId
    );
    if (!found) return null;

    if (
      !found.id || typeof found.id !== 'string' || found.id.trim().length === 0 ||
      found.organizationId !== organizationId ||
      found.businessId !== businessId ||
      !found.name || typeof found.name !== 'string' || found.name.trim().length === 0 || found.name.length > 256 ||
      !isValidResourceType(found.resourceType) ||
      !isValidResourceStatus(found.status) ||
      typeof found.capacityUnits !== 'number' || !Number.isSafeInteger(found.capacityUnits) || found.capacityUnits <= 0 ||
      !found.createdAt || typeof found.createdAt !== 'string' || !isValidIsoWithTimezone(found.createdAt)
    ) {
      throw new Error('APPOINTMENT_RESOURCE_LOOKUP_FAILED');
    }

    return found;
  }
}
