// src/middlewares/authorize.middleware.ts
import { MiddlewareHandler } from 'hono';
import AppError from '../utils/AppError';
import { AuthVariables } from 'types';
import { PrismaClient } from '@prisma/client';
import { PrismaD1 } from '@prisma/adapter-d1';

// Cache (Keep simple in-memory cache logic or replace with Redis later)
const rolePermissionsCache = new Map<string, { permissions: Set<string>, timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getPermissionsForRole(roleId: string, prisma: PrismaClient): Promise<Set<string>> {
    // const cachedEntry = rolePermissionsCache.get(roleId);
    // if (cachedEntry && (Date.now() - cachedEntry.timestamp < CACHE_TTL)) {
    //     return cachedEntry.permissions;
    // }

    const roleWithPermissions = await prisma.role.findUnique({
        where: { id: roleId },
        include: {
            permissions: {
                include: {
                    permission: { select: { name: true } }
                }
            }
        }
    });

    if (!roleWithPermissions) {
        return new Set();
    }

    const permissionsSet = new Set(
        roleWithPermissions.permissions.map(rp => rp.permission.name)
    );

    // Update cache
    rolePermissionsCache.set(roleId, { permissions: permissionsSet, timestamp: Date.now() });

    // Optional: Clean up old cache entries periodically (not shown here)

    return permissionsSet;
}

/**
 * Hono Middleware factory to check if the logged-in user (via c.var.user)
 * has ALL the required permissions. Use AFTER 'protect'.
 * @param requiredPermissions Array of required permission names.
 */
export const authorize = (requiredPermissions: string[]): MiddlewareHandler<AuthVariables> => {
    return async (c, next) => {
        const user = c.get('user'); // Get user from context variables

        if (!user || !user.roleId) {
            // Should generally not happen if 'protect' runs first, but good practice
            throw new AppError('Não autorizado (usuário ou role não identificado).', 401);
            // OR: return c.json({ status: 'fail', message: 'Não autorizado (usuário ou role não identificado).' }, 401);
        }

        if (requiredPermissions.length === 0) {
            // No specific permissions required, just authentication
            await next();
            return;
        }

        const userRoleId = user.roleId;

        try {
            const adapter = new PrismaD1(c.env.DB);
            const prisma = new PrismaClient({ adapter });

            const userPermissions = await getPermissionsForRole(userRoleId, prisma);
            const hasAllPermissions = requiredPermissions.every(rp => userPermissions.has(rp));

            if (!hasAllPermissions) {
                const missing = requiredPermissions.filter(rp => !userPermissions.has(rp));
                console.warn(`Forbidden access for user ${user.id} (roleId: ${userRoleId}). Missing permissions: ${missing.join(', ')}`);
                throw new AppError('Proibido. Permissões insuficientes.', 403);
                // OR: return c.json({ status: 'fail', message: 'Proibido. Permissões insuficientes.' }, 403);
            }

            // Permissions grant access
            await next();

        } catch (error) {
            if (error instanceof AppError) {
                throw error; // Re-throw known AppErrors
            }
            // Handle unexpected errors during permission check
            console.error('Erro no middleware de autorização:', error);
            throw new AppError('Erro interno ao verificar permissões.', 500);
            // OR: return c.json({ status: 'error', message: 'Erro interno ao verificar permissões.' }, 500);
        }
    };
};