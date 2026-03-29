import { AuditActorSource, DomainEntityType } from "@prisma/client";
import type { CustomerRecord } from "@/modules/operations/types";
import { recordAuditEvent } from "@/modules/audit/service";
import type { SessionUser } from "@/shared/auth/types";
import { getDatabaseClient } from "@/shared/db/readiness";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";

function mapCustomerRecord(customer: {
  id: string;
  businessName: string;
  vatNumber: string | null;
  mainPhone: string | null;
  mainEmail: string | null;
  notes: string | null;
  createdByUserId: string | null;
  createdByUserNameSnapshot?: string | null;
  createdBy: { fullName: string } | null;
  locations: Array<{
    id: string;
    customerId: string;
    name: string;
    address: string;
    city: string | null;
    notes: string | null;
    createdByUserId: string | null;
    createdByUserNameSnapshot?: string | null;
    createdBy: { fullName: string } | null;
  }>;
}): CustomerRecord {
  return {
    id: customer.id,
    businessName: customer.businessName,
    vatNumber: customer.vatNumber,
    mainPhone: customer.mainPhone,
    mainEmail: customer.mainEmail,
    notes: customer.notes,
    createdByUserId: customer.createdByUserId,
    createdByUserName: customer.createdBy?.fullName ?? null,
    locations: customer.locations.map((location) => ({
      id: location.id,
      customerId: location.customerId,
      name: location.name,
      address: location.address,
      city: location.city,
      notes: location.notes,
      createdByUserId: location.createdByUserId,
      createdByUserName: location.createdBy?.fullName ?? null,
    })),
  };
}

export async function listCustomers() {
  const db = await getDatabaseClient();

  const customers = await db.customer.findMany({
    include: {
      createdBy: {
        select: { fullName: true },
      },
      locations: {
        include: {
          createdBy: {
            select: { fullName: true },
          },
        },
        orderBy: { name: "asc" },
      },
    },
    orderBy: { businessName: "asc" },
  });

  return customers.map(mapCustomerRecord);
}

export async function getCustomerById(customerId: string) {
  const db = await getDatabaseClient();

  const customer = await db.customer.findUnique({
    where: { id: customerId },
    include: {
      createdBy: {
        select: { fullName: true },
      },
      locations: {
        include: {
          createdBy: {
            select: { fullName: true },
          },
        },
        orderBy: { name: "asc" },
      },
    },
  });

  return customer ? mapCustomerRecord(customer) : null;
}

export async function createCustomer(
  input: {
    businessName: string;
    vatNumber?: string | null;
    mainPhone?: string | null;
    mainEmail?: string | null;
    notes?: string | null;
  },
  actor: SessionUser,
) {
  const db = await getDatabaseClient();

  const customer = await db.customer.create({
    data: {
      businessName: input.businessName,
      vatNumber: input.vatNumber ?? null,
      mainPhone: input.mainPhone ?? null,
      mainEmail: input.mainEmail ?? null,
      notes: input.notes ?? null,
      createdByUserId: actor.id,
    },
    include: {
      createdBy: {
        select: { fullName: true },
      },
      locations: {
        include: {
          createdBy: {
            select: { fullName: true },
          },
        },
      },
    },
  });

  const mapped = mapCustomerRecord(customer);

  await recordAuditEvent({
    actorUserId: actor.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.CUSTOMER,
    entityId: mapped.id,
    eventName: "customer.created",
    afterJson: mapped,
  });

  return mapped;
}

export async function createLocation(
  customerId: string,
  input: {
    name: string;
    address: string;
    city?: string | null;
    notes?: string | null;
  },
  actor: SessionUser,
) {
  const db = await getDatabaseClient();

  const location = await db.location.create({
    data: {
      customerId,
      name: input.name,
      address: input.address,
      city: input.city ?? null,
      notes: input.notes ?? null,
      createdByUserId: actor.id,
    },
    include: {
      createdBy: {
        select: { fullName: true },
      },
    },
  });

  await recordAuditEvent({
    actorUserId: actor.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.LOCATION,
    entityId: location.id,
    eventName: "location.created",
    afterJson: location,
  });

  return {
    id: location.id,
    customerId: location.customerId,
    name: location.name,
    address: location.address,
    city: location.city,
    notes: location.notes,
    createdByUserId: location.createdByUserId,
    createdByUserName: location.createdBy?.fullName ?? null,
  };
}

export async function deleteCustomer(customerId: string, actor: SessionUser) {
  const db = await getDatabaseClient();

  const customer = await db.customer.findUnique({
    where: { id: customerId },
    include: {
      createdBy: {
        select: { fullName: true },
      },
      locations: {
        include: {
          createdBy: {
            select: { fullName: true },
          },
        },
        orderBy: { name: "asc" },
      },
    },
  });

  if (!customer) {
    return null;
  }

  const before = mapCustomerRecord(customer);
  const [requestCount, workOrderCount, reminderCount] = await Promise.all([
    db.request.count({
      where: { customerId },
    }),
    db.workOrder.count({
      where: { customerId },
    }),
    db.invoiceReminder.count({
      where: { customerId },
    }),
  ]);

  if (
    customer.locations.length > 0 ||
    requestCount > 0 ||
    workOrderCount > 0 ||
    reminderCount > 0
  ) {
    throw new BusinessRuleError(
      "CUSTOMER_DELETE_BLOCKED",
      "Ο πελάτης έχει συνδεδεμένες εγκαταστάσεις, αιτήματα, work orders ή reminders. Διέγραψε πρώτα τα συνδεδεμένα δεδομένα.",
      409,
      {
        locationCount: customer.locations.length,
        requestCount,
        workOrderCount,
        reminderCount,
      },
    );
  }

  await db.customer.delete({
    where: { id: customerId },
  });

  await recordAuditEvent({
    actorUserId: actor.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.CUSTOMER,
    entityId: customerId,
    eventName: "customer.deleted",
    beforeJson: before,
  });

  return before;
}

export async function deleteLocation(locationId: string, actor: SessionUser) {
  const db = await getDatabaseClient();

  const location = await db.location.findUnique({
    where: { id: locationId },
    include: {
      createdBy: {
        select: { fullName: true },
      },
    },
  });

  if (!location) {
    return null;
  }

  const [requestCount, workOrderCount, equipmentCount] = await Promise.all([
    db.request.count({ where: { locationId } }),
    db.workOrder.count({ where: { locationId } }),
    db.equipment.count({ where: { locationId } }),
  ]);

  if (requestCount > 0 || workOrderCount > 0 || equipmentCount > 0) {
    throw new BusinessRuleError(
      "LOCATION_DELETE_BLOCKED",
      "Η εγκατάσταση έχει συνδεδεμένο εξοπλισμό, αιτήματα ή work orders. Διέγραψε πρώτα τα συνδεδεμένα δεδομένα.",
      409,
      {
        requestCount,
        workOrderCount,
        equipmentCount,
      },
    );
  }

  const before = {
    id: location.id,
    customerId: location.customerId,
    name: location.name,
    address: location.address,
    city: location.city,
    notes: location.notes,
    createdByUserId: location.createdByUserId,
    createdByUserName: location.createdBy?.fullName ?? null,
  };

  await db.location.delete({
    where: { id: locationId },
  });

  await recordAuditEvent({
    actorUserId: actor.id,
    actorSource: AuditActorSource.APP,
    entityType: DomainEntityType.LOCATION,
    entityId: locationId,
    eventName: "location.deleted",
    beforeJson: before,
  });

  return before;
}
