// src/controllers/vehicle.controller.ts
import AppError from '../utils/AppError';
import { Prisma, PrismaClient } from '@prisma/client'; // Import Prisma namespace for types
import { protect } from 'middlewares/auth.middleware';
import { AppEnv, Hono } from 'hono';
import { prismaMiddleware } from 'middlewares/prisma.middleware';
import { authorize } from 'middlewares/authorize.middleware';
import permissions from 'utils/permissions';
import { zValidator } from '@hono/zod-validator';
import { createVehicleSchema, grantAuthorizationSchema, revokeAuthorizationSchema, updateVehicleSchema, vehicleIdSchema } from 'validators/vehicle.validator';
import next from 'middlewares/next.middleware';


const vehicleRoutesController = new Hono<AppEnv>();
// --- Obter Detalhes do Usuário Logado ---
vehicleRoutesController.use(protect)
vehicleRoutesController.use('*', prismaMiddleware);

// --- Helper Function (optional but recommended) ---
/**
 * Checks if a user has access to a specific vehicle (either owner or authorized).
 * Throws AppError (403 or 404) if access denied or vehicle not found.
 */
export async function checkVehicleAccess(prisma: PrismaClient, userId: string, vehicleId: string): Promise<Prisma.VehicleGetPayload<{}>> {
    const vehicle = await prisma.vehicle.findUnique({
        where: { id: vehicleId },
        include: { authorizedUsers: { where: { userId: userId }, select: { userId: true } } } // Check authorization efficiently
    });

    if (!vehicle) {
        throw new AppError(`Veículo com ID ${vehicleId} não encontrado.`, 404);
    }

    const isOwner = vehicle.ownerId === userId;
    const isAuthorized = vehicle.authorizedUsers.length > 0; // User ID found in the relation

    if (!isOwner && !isAuthorized) {
        throw new AppError('Acesso proibido a este veículo.', 403);
    }
    // Remove temporary relation data before returning
    // delete (vehicle as any).authorizedUsers; // Or use Prisma select without it if not needed later
    return vehicle; // Return the vehicle if access is granted
}


// --- CRUD Operations ---
vehicleRoutesController.post(
    '/',
    authorize([permissions.vehicle.create]),
    zValidator('json', createVehicleSchema.shape.body),
    async (req) => {

        try {
            const ownerId = req.get('user').id;
            const roleId = req.get('user')!.roleId;
            const data = req.req.valid('json');
            const prisma = req.get('prisma');
            const basicRole = await prisma.role.findUnique({
                where: { name: 'BASIC_USER' },
                select: { id: true }
            });

            if (!basicRole) {
                return next(new AppError('Erro interno ao verificar permissões de criação.', 500));
            }

            const basicUserRoleId = basicRole.id;

            if (basicUserRoleId === roleId) {
                // Conta quantos veículos este usuário JÁ POSSUI
                const vehicleCount = await prisma.vehicle.count({
                    where: {
                        ownerId: ownerId,
                    },
                });

                // Se o usuário já tem 1 ou mais veículos, impede a criação
                if (vehicleCount >= 1) {
                    return next(new AppError(
                        'Usuários do plano básico podem adicionar apenas 1 veículo. Considere fazer um upgrade para adicionar mais.',
                        403 // 403 Forbidden é apropriado aqui (permissão negada devido à limitação)
                    ));
                }
            }

            // 1. Validate CategoryId exists
            const categoryExists = await prisma.vehicleCategory.findUnique({
                where: { id: data.categoryId },
                select: { id: true },
            });
            if (!categoryExists) {
                return next(new AppError(`Categoria com ID ${data.categoryId} não encontrada.`, 404));
            }

            // 2. Check for existing plate (case-insensitive recommended for plates)
            const plateExists = await prisma.vehicle.findUnique({
                where: { plate: data.plate }, // Consider .toLowerCase() on both sides if needed
                select: { id: true },
            });
            if (plateExists) {
                return next(new AppError(`Placa ${data.plate} já cadastrada.`, 409));
            }

            // 3. Create Vehicle
            const newVehicle = await prisma.vehicle.create({
                data: {
                    ...data,
                    ownerId: ownerId, // Assign the logged-in user as owner
                },
                select: { // Select fields to return
                    id: true, alias: true, brand: true, model: true, plate: true, yearManufacture: true, yearModel: true, color: true, appOdometer: true, appFuelTank: true, createdAt: true,
                    category: { select: { id: true, name: true } }, // Include category name
                    owner: { select: { id: true, username: true } } // Include owner username
                }
            });

            return req.json(newVehicle, 201);
        } catch (error) {
            next(error);
        }
    }
);

vehicleRoutesController.get(
    '/',
    authorize([permissions.vehicle.read]),
    async (req) => {
        try {
            const userId = req.get('user').id;
            const prisma = req.get('prisma');
            const vehicles = await prisma.vehicle.findMany({
                where: {
                    // User is the owner OR user is in the list of authorized users for the vehicle
                    OR: [
                        { ownerId: userId },
                        { authorizedUsers: { some: { userId: userId } } }
                    ]
                },
                orderBy: { createdAt: 'desc' }, // Example ordering
                select: { // Select concise fields for list view
                    id: true,
                    alias: true,
                    brand: true,
                    model: true,
                    plate: true,
                    appOdometer: true,
                    appFuelTank: true,
                    kmlCity: true,
                    kmlRoad: true,
                    color: true,
                    yearModel: true,
                    yearManufacture: true,
                    category: {
                        select: {
                            id: true,
                            name: true,
                            iconName: true
                        }
                    }
                }
            });
            return req.json(vehicles, 200);
        } catch (error) {
            next(error);
        }
    }
);

vehicleRoutesController.get(
    '/:vehicleId',
    authorize([permissions.vehicle.read]),
    zValidator('param', vehicleIdSchema.shape.params),
    async (req) => {
        try {
            const userId = req.get('user')!.id;
            const { vehicleId } = req.req.valid('param');
            const prisma = req.get('prisma');
            // Use helper to check access and get vehicle data
            await checkVehicleAccess(prisma, userId, vehicleId);

            // Fetch full details if needed (or adjust helper to fetch more initially)
            const fullVehicleDetails = await prisma.vehicle.findUnique({
                where: { id: vehicleId },
                include: {
                    category: true,
                    owner: { select: { id: true, username: true } },
                    authorizedUsers: { select: { user: { select: { id: true, username: true } } } } // Show authorized users
                }
            })

            return req.json(fullVehicleDetails, 200);
        } catch (error) {
            next(error); // Handles AppError from checkVehicleAccess (403/404) or other errors
        }
    }
);

vehicleRoutesController.patch(
    '/:vehicleId',
    authorize([permissions.vehicle.update]),
    zValidator('param', updateVehicleSchema.shape.params),
    zValidator('json', updateVehicleSchema.shape.body),
    async (req) => {

        try {
            const userId = req.get('user')!.id;
            const { vehicleId } = req.req.valid('param');
            const dataToUpdate = req.req.valid('json');
            const prisma = req.get('prisma');
            // 1. Check if user has access to the vehicle (owner or authorized)
            // Note: checkVehicleAccess ensures the vehicle exists
            await checkVehicleAccess(prisma, userId, vehicleId);

            // 2. Optional: Validate new CategoryId if provided
            if (dataToUpdate.categoryId) {
                const categoryExists = await prisma.vehicleCategory.findUnique({
                    where: { id: dataToUpdate.categoryId }, select: { id: true },
                });
                if (!categoryExists) {
                    return next(new AppError(`Categoria com ID ${dataToUpdate.categoryId} não encontrada.`, 404));
                }
            }

            // 3. Optional: Validate new Plate if provided (check for conflicts)
            if (dataToUpdate.plate) {
                const plateConflict = await prisma.vehicle.findFirst({
                    where: {
                        plate: dataToUpdate.plate,
                        NOT: { id: vehicleId } // Exclude current vehicle from check
                    },
                    select: { id: true },
                });
                if (plateConflict) {
                    return next(new AppError(`Placa ${dataToUpdate.plate} já pertence a outro veículo.`, 409));
                }
            }

            // 4. Update the vehicle
            const updatedVehicle = await prisma.vehicle.update({
                where: { id: vehicleId },
                data: dataToUpdate, // Prisma handles partial updates correctly
                select: { // Select fields to return
                    id: true, alias: true, brand: true, model: true, plate: true, yearManufacture: true, yearModel: true, color: true, appOdometer: true, createdAt: true, updatedAt: true,
                    category: { select: { id: true, name: true } },
                    owner: { select: { id: true, username: true } }
                }
            });

            return req.json(updatedVehicle, 200);

        } catch (error) {
            next(error); // Handles AppError from checkVehicleAccess or validation/DB errors
        }
    }
);

vehicleRoutesController.delete(
    '/:vehicleId',
    authorize([permissions.vehicle.delete]),
    zValidator('param', vehicleIdSchema.shape.params),
    async (req) => {
        try {
            const userId = req.get('user')!.id;
            const { vehicleId } = req.req.valid('param');
            const prisma = req.get('prisma');
            // 1. Fetch vehicle to check OWNERSHIP specifically for deletion
            const vehicle = await prisma.vehicle.findUnique({
                where: { id: vehicleId },
                select: { ownerId: true } // Only need ownerId
            });

            if (!vehicle) {
                return next(new AppError(`Veículo com ID ${vehicleId} não encontrado.`, 404));
            }

            // 2. Enforce that ONLY the owner can delete
            if (vehicle.ownerId !== userId) {
                return next(new AppError('Apenas o proprietário pode excluir o veículo.', 403));
            }

            // 3. Delete the vehicle
            // Note: This might fail if related records (like Expenses) have restrictive onDelete rules.
            // The errorHandler should catch Prisma P2003/P2014 if that happens.
            await prisma.vehicle.delete({
                where: { id: vehicleId },
            });

            return req.status(204); // No Content
        } catch (error) {
            next(error); // Handles not found, forbidden, or DB constraint errors
        }
    }
);


// --- Authorization Management Controllers ---
vehicleRoutesController.post(
    '/:vehicleId/authorizations',
    authorize([permissions.feature.authorize]), // Only owner can authorize
    zValidator('param', grantAuthorizationSchema.shape.params),
    zValidator('json', grantAuthorizationSchema.shape.body),
    async (req) => {

        try {
            const ownerId = req.get('user')!.id; // The user making the request (must be the owner)
            const { vehicleId } = req.req.valid('param');
            const { userId: userIdToAuthorize } = req.req.valid('json');
            const prisma = req.get('prisma');
            // 1. Check if the requester is the actual owner of the vehicle
            const vehicle = await prisma.vehicle.findUnique({
                where: { id: vehicleId },
                select: { ownerId: true }
            });

            if (!vehicle) {
                return next(new AppError(`Veículo com ID ${vehicleId} não encontrado.`, 404));
            }
            if (vehicle.ownerId !== ownerId) {
                return next(new AppError('Apenas o proprietário pode conceder autorização.', 403));
            }

            // 2. Prevent authorizing oneself
            if (ownerId === userIdToAuthorize) {
                return next(new AppError('Você não pode autorizar a si mesmo.', 400));
            }

            // 3. Check if the user being authorized actually exists
            const userToAuthorizeExists = await prisma.user.findUnique({
                where: { id: userIdToAuthorize }, select: { id: true }
            });
            if (!userToAuthorizeExists) {
                return next(new AppError(`Usuário com ID ${userIdToAuthorize} não encontrado.`, 404));
            }

            // 4. Create the authorization record
            // Use upsert or create with error handling for duplicates
            try {
                const authorization = await prisma.userVehicleAuthorization.create({
                    data: {
                        userId: userIdToAuthorize,
                        vehicleId: vehicleId,
                    },
                    select: { // Select fields for response confirmation
                        user: { select: { id: true, username: true } },
                        vehicle: { select: { id: true, alias: true } },
                        createdAt: true
                    }
                });
                return req.json({ message: 'Autorização concedida com sucesso.', authorization }, 201);
            } catch (e) {
                if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
                    // Unique constraint failed - already authorized
                    return next(new AppError(`Usuário já está autorizado para este veículo.`, 409));
                }
                throw e; // Re-throw other errors
            }


        } catch (error) {
            next(error);
        }
    }
);

vehicleRoutesController.delete(
    '/:vehicleId/authorizations/:userId',
    authorize([permissions.feature.authorize]), // Only owner can revoke (matches the grant permission for simplicity)
    zValidator('param', revokeAuthorizationSchema.shape.params),
    async (req) => {

        try {
            const ownerId = req.get('user')!.id; // The user making the request (must be the owner)
            const { vehicleId, userId: userIdToRevoke } = req.req.valid('param');
            const prisma = req.get('prisma');
            // 1. Check if the requester is the actual owner of the vehicle
            const vehicle = await prisma.vehicle.findUnique({
                where: { id: vehicleId },
                select: { ownerId: true }
            });

            if (!vehicle) {
                return next(new AppError(`Veículo com ID ${vehicleId} não encontrado.`, 404));
            }
            if (vehicle.ownerId !== ownerId) {
                return next(new AppError('Apenas o proprietário pode revogar autorização.', 403));
            }

            // 2. Attempt to delete the authorization record
            // Deleting by composite key
            await prisma.userVehicleAuthorization.delete({
                where: {
                    userId_vehicleId: { // Composite key identifier
                        userId: userIdToRevoke,
                        vehicleId: vehicleId
                    }
                }
            });

            return req.status(204); // Success, no content

        } catch (error) {
            // Handle case where the authorization record didn't exist (P2025)
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
                return next(new AppError('Autorização não encontrada para este usuário e veículo.', 404));
            }
            next(error); // Handle other errors
        }
    }
);


export default vehicleRoutesController;