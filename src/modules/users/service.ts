import { UserRole } from "@prisma/client";
import { getPermissionsForRole, isAppRole } from "@/shared/auth/roles";
import type { AppRole, SessionUser } from "@/shared/auth/types";
import { verifyPassword, hashPassword } from "@/shared/auth/local-auth";
import { getDatabaseClient } from "@/shared/db/readiness";
import { BusinessRuleError } from "@/shared/domain/business-rule-error";

function fromDatabaseRole(role: UserRole): AppRole {
  return role.toLowerCase() as AppRole;
}

function toDatabaseRole(role: AppRole): UserRole {
  return role.toUpperCase() as UserRole;
}

function mapDatabaseUserToSessionUser(user: {
  id: string;
  auth0UserId: string | null;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  phoneNumber: string | null;
}): SessionUser {
  const role = fromDatabaseRole(user.role);

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role,
    permissions: getPermissionsForRole(role),
    authSource: user.auth0UserId ? "auth0" : "local",
    isActive: user.isActive,
    phoneNumber: user.phoneNumber ?? undefined,
  };
}

export async function listUsers(): Promise<SessionUser[]> {
  const db = await getDatabaseClient();

  const users = await db.user.findMany({
    where: {
      deletedAt: null,
    },
    orderBy: [{ role: "asc" }, { fullName: "asc" }],
  });

  return users.map(mapDatabaseUserToSessionUser);
}

export async function getSessionUserByAuthIdentity(input: {
  auth0UserId?: string | null;
  email?: string | null;
}) {
  const db = await getDatabaseClient();
  const auth0UserId = input.auth0UserId?.trim() || null;
  const email = input.email?.trim().toLowerCase() || null;

  if (!auth0UserId && !email) {
    return null;
  }

  const user = await db.user.findFirst({
    where: {
      OR: [
        ...(auth0UserId ? [{ auth0UserId }] : []),
        ...(email ? [{ email }] : []),
      ],
    },
  });

  if (!user) {
    return null;
  }

  const mapped = mapDatabaseUserToSessionUser(user);
  return user.deletedAt
    ? {
        ...mapped,
        isActive: false,
      }
    : mapped;
}

export async function getSessionUserById(userId: string) {
  const db = await getDatabaseClient();
  const user = await db.user.findUnique({
    where: { id: userId },
  });

  if (!user || user.deletedAt) {
    return null;
  }

  return mapDatabaseUserToSessionUser(user);
}

export async function assertAssignableTechnicianUserId(userId: string) {
  const db = await getDatabaseClient();
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      isActive: true,
    },
  });

  if (!user) {
    throw new BusinessRuleError(
      "ASSIGNEE_NOT_FOUND",
      "Ο ανατεθειμένος χρήστης δεν βρέθηκε.",
      404,
    );
  }

  if (!user.isActive) {
    throw new BusinessRuleError(
      "ASSIGNEE_INACTIVE",
      "Δεν μπορεί να γίνει ανάθεση σε ανενεργό χρήστη.",
      409,
    );
  }

  if (user.role !== UserRole.TECHNICIAN) {
    throw new BusinessRuleError(
      "ASSIGNEE_NOT_TECHNICIAN",
      "Η ανάθεση επιτρέπεται μόνο σε ενεργό τεχνικό.",
      422,
    );
  }

  return user;
}

export async function authenticateLocalUser(email: string, password: string) {
  const db = await getDatabaseClient();
  const user = await db.user.findUnique({
    where: { email: email.trim().toLowerCase() },
  });

  if (!user || user.deletedAt || !user.isActive || !verifyPassword(password, user.passwordHash)) {
    return null;
  }

  return mapDatabaseUserToSessionUser(user);
}

export async function createLocalUser(input: {
  email: string;
  fullName: string;
  role: AppRole;
  password: string;
  phoneNumber?: string | null;
}) {
  const db = await getDatabaseClient();
  const normalizedEmail = input.email.trim().toLowerCase();
  const normalizedPhone = input.phoneNumber?.trim() || null;

  const existing = await db.user.findFirst({
    where: {
      OR: [
        { email: normalizedEmail },
        ...(normalizedPhone ? [{ phoneNumber: normalizedPhone }] : []),
      ],
    },
  });

  if (existing) {
    throw new BusinessRuleError(
      "USER_ALREADY_EXISTS",
      existing.email === normalizedEmail
        ? "Υπάρχει ήδη χρήστης με αυτό το email."
        : "Υπάρχει ήδη χρήστης με αυτό το τηλέφωνο.",
      409,
    );
  }

  const created = await db.user.create({
    data: {
      email: normalizedEmail,
      fullName: input.fullName.trim(),
      role: toDatabaseRole(input.role),
      passwordHash: hashPassword(input.password),
      phoneNumber: normalizedPhone,
    },
  });

  return mapDatabaseUserToSessionUser(created);
}

export async function updateLocalUser(
  userId: string,
  input: Partial<{
    fullName: string;
    role: AppRole;
    password: string;
    phoneNumber: string | null;
    isActive: boolean;
  }>,
) {
  const db = await getDatabaseClient();
  const existing = await db.user.findUnique({
    where: { id: userId },
  });

  if (!existing || existing.deletedAt) {
    return null;
  }

  const normalizedPhone =
    "phoneNumber" in input ? input.phoneNumber?.trim() || null : undefined;

  if (normalizedPhone !== undefined && normalizedPhone !== existing.phoneNumber) {
    const phoneConflict = normalizedPhone
      ? await db.user.findFirst({
          where: {
            phoneNumber: normalizedPhone,
            NOT: { id: userId },
          },
        })
      : null;

    if (phoneConflict) {
      throw new BusinessRuleError(
        "USER_PHONE_CONFLICT",
        "Υπάρχει ήδη χρήστης με αυτό το τηλέφωνο.",
        409,
      );
    }
  }

  const nextRole = input.role ? toDatabaseRole(input.role) : existing.role;
  const nextIsActive =
    "isActive" in input ? Boolean(input.isActive) : existing.isActive;

  if ((existing.role === UserRole.ADMIN || nextRole === UserRole.ADMIN) && !nextIsActive) {
    const activeAdminCount = await db.user.count({
      where: {
        role: UserRole.ADMIN,
        isActive: true,
        NOT: { id: userId },
      },
    });

    if (activeAdminCount === 0) {
      throw new BusinessRuleError(
        "LAST_ADMIN_PROTECTION",
        "Δεν μπορεί να απενεργοποιηθεί ο τελευταίος ενεργός admin.",
        409,
      );
    }
  }

  const updated = await db.user.update({
    where: { id: userId },
    data: {
      fullName: typeof input.fullName === "string" ? input.fullName.trim() : undefined,
      role: input.role ? toDatabaseRole(input.role) : undefined,
      passwordHash: input.password ? hashPassword(input.password) : undefined,
      phoneNumber: normalizedPhone,
      isActive: "isActive" in input ? Boolean(input.isActive) : undefined,
    },
  });

  return mapDatabaseUserToSessionUser(updated);
}

export async function deactivateLocalUser(userId: string) {
  return updateLocalUser(userId, { isActive: false });
}

export async function deleteLocalUser(userId: string) {
  const db = await getDatabaseClient();
  const existing = await db.user.findUnique({
    where: { id: userId },
  });

  if (!existing || existing.deletedAt) {
    throw new BusinessRuleError("USER_NOT_FOUND", "Ο χρήστης δεν βρέθηκε.", 404);
  }

  if (existing.role === "ADMIN" && existing.isActive) {
    const activeAdminCount = await db.user.count({
      where: {
        role: "ADMIN",
        isActive: true,
        NOT: { id: userId },
      },
    });

    if (activeAdminCount === 0) {
      throw new BusinessRuleError(
        "LAST_ADMIN_PROTECTION",
        "Δεν μπορεί να διαγραφεί ο τελευταίος ενεργός admin.",
        409,
      );
    }
  }

  await db.user.update({
    where: { id: userId },
    data: {
      isActive: false,
      deletedAt: new Date(),
    },
  });

  return true;
}

export async function syncUserFromSession(params: {
  auth0UserId: string;
  email: string;
  fullName: string;
  roleFromClaims?: string | null;
  phoneNumber?: string;
}) {
  try {
    const db = await getDatabaseClient();

    const existingUser = await db.user.findFirst({
      where: {
        OR: [
          { auth0UserId: params.auth0UserId },
          { email: params.email.toLowerCase() },
        ],
      },
    });

    if (existingUser) {
      const updated = await db.user.update({
        where: { id: existingUser.id },
        data: {
          auth0UserId: params.auth0UserId,
          email: params.email.toLowerCase(),
          fullName: params.fullName,
          phoneNumber: params.phoneNumber,
        },
      });

      return {
        ok: true as const,
        userId: updated.id,
        role: fromDatabaseRole(updated.role),
        created: false,
      };
    }

    if (!params.roleFromClaims || !isAppRole(params.roleFromClaims)) {
      return {
        ok: false as const,
        code: "ROLE_ASSIGNMENT_REQUIRED",
      };
    }

    const created = await db.user.create({
      data: {
        auth0UserId: params.auth0UserId,
        email: params.email.toLowerCase(),
        fullName: params.fullName,
        phoneNumber: params.phoneNumber,
        role: toDatabaseRole(params.roleFromClaims),
      },
    });

    return {
      ok: true as const,
      userId: created.id,
      role: fromDatabaseRole(created.role),
      created: true,
    };
  } catch {
    return {
      ok: false as const,
      code: "DATABASE_NOT_CONFIGURED",
    };
  }
}
