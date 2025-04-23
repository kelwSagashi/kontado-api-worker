// src/controllers/vehicleCategory.controller.ts
import AppError from '../utils/AppError';
import { Prisma, PrismaClient } from '@prisma/client';

import {
    CreateVehicleCategoryInput,
    UpdateVehicleCategoryInput,
    CategoryIdParams,
    createVehicleCategorySchema,
    categoryIdParamSchema,
    updateVehicleCategorySchema
} from '../validators/vehicleCategory.validator';
import { AppEnv, Context, Hono } from 'hono';
import { protect } from 'middlewares/auth.middleware';
import { PrismaD1 } from '@prisma/adapter-d1';
import next from 'middlewares/next.middleware';
import { authorize } from 'middlewares/authorize.middleware';
import permissions from 'utils/permissions';
import { zValidator } from '@hono/zod-validator';

const getPrisma = (c: Context<AppEnv>) => {
    const adapter = new PrismaD1(c.env.DB);
    const prisma = new PrismaClient({ adapter });
    if (!prisma) throw new AppError('Internal server configuration error (Prisma).', 500);
    return prisma;
}

const vehicleCategoryRoutesController = new Hono<AppEnv>();

// Apply common middleware
vehicleCategoryRoutesController.use('*', protect); // Protect all and ensure Prisma

// ==============================
// Vehicle category Routes
// ==============================

// POST /api/vehicle-categories - Admin Only
vehicleCategoryRoutesController.post(
    '/',
    authorize([permissions.admin.update_any]),
    zValidator('json', createVehicleCategorySchema.shape.body),
    async (c) => {
        const { name, iconName } = c.req.valid('json');
        try {
            const prisma = getPrisma(c);
            // Check if name already exists (case-insensitive check might be better)
            const existing = await prisma.vehicleCategory.findUnique({
                where: { name: name } // Prisma default is case-sensitive depending on DB collation
                // Consider: where: { name: { equals: name, mode: 'insensitive' } } for PostgreSQL
            });
            if (existing) {
                return next(new AppError(`Categoria com nome '${name}' já existe.`, 409));
            }

            const newCategory = await prisma.vehicleCategory.create({
                data: { name, iconName },
                select: { id: true, name: true, iconName: true, createdAt: true }
            });
            return c.json(newCategory);

        } catch (error) {
            next(error);
        }
    }
);


// GET /api/vehicle-categories - All Logged-in Users
vehicleCategoryRoutesController.get(
    '/',
    authorize([permissions.user.any]),
    async (c) => {
        try {
            const prisma = getPrisma(c);
            const categories = await prisma.vehicleCategory.findMany({
                orderBy: { name: 'asc' },
            });
            return c.json(categories);
        } catch (error) {
            next(error);
        }
    }
);

// GET /api/vehicle-categories/:categoryId - All Logged-in Users
vehicleCategoryRoutesController.get(
    '/:categoryId',
    authorize([permissions.user.any]),
    zValidator('param', categoryIdParamSchema.shape.params),
    async (c) => {
        const { categoryId } = c.req.valid('param');
        try {
            const prisma = getPrisma(c);
            const category = await prisma.vehicleCategory.findUnique({
                where: { id: categoryId },
                select: { id: true, name: true, iconName: true, createdAt: true, updatedAt: true }
            });

            if (!category) {
                return next(new AppError(`Categoria com ID ${categoryId} não encontrada.`, 404));
            }
            return c.json(category);
        } catch (error) {
            next(error);
        }
    }
);

// PATCH /api/vehicle-categories/:categoryId - Admin Only
vehicleCategoryRoutesController.patch(
    '/:categoryId',
    authorize([permissions.admin.update_any]),
    zValidator('param', updateVehicleCategorySchema.shape.params),
    zValidator('json', updateVehicleCategorySchema.shape.body),
    async (c) => {
        const { categoryId } = c.req.valid('param');
        const dataToUpdate = c.req.valid('json');

        try {
            const prisma = getPrisma(c);
            // Check if category exists first
            const currentCategory = await prisma.vehicleCategory.findUnique({
                where: { id: categoryId }, select: { id: true }
            });
            if (!currentCategory) {
                return next(new AppError(`Categoria com ID ${categoryId} não encontrada.`, 404));
            }

            // Check for name conflict if name is being updated
            if (dataToUpdate.name) {
                const nameConflict = await prisma.vehicleCategory.findFirst({
                    where: {
                        name: dataToUpdate.name,
                        NOT: { id: categoryId } // Exclude self
                        // Consider: mode: 'insensitive'
                    },
                    select: { id: true }
                });
                if (nameConflict) {
                    return next(new AppError(`Categoria com nome '${dataToUpdate.name}' já existe.`, 409));
                }
            }

            const updatedCategory = await prisma.vehicleCategory.update({
                where: { id: categoryId },
                data: dataToUpdate,
                select: { id: true, name: true, iconName: true, createdAt: true, updatedAt: true }
            });
            return c.json(updatedCategory);

        } catch (error) {
            next(error);
        }
    }
);


// DELETE /api/vehicle-categories/:categoryId - Admin Only
vehicleCategoryRoutesController.delete(
    '/:categoryId',
    authorize([permissions.admin.delete_any]),
    zValidator('param', categoryIdParamSchema.shape.params),
    async (c) => {
        const { categoryId } = c.req.valid('param');
        try {
            const prisma = getPrisma(c);
            // Check existence first (optional, delete throws P2025 if not found)
            const categoryExists = await prisma.vehicleCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
            if (!categoryExists) {
                return next(new AppError(`Categoria com ID ${categoryId} não encontrada.`, 404));
            }

            // Attempt to delete
            await prisma.vehicleCategory.delete({
                where: { id: categoryId }
            });
            return c.body(null, 204);

        } catch (error) {
            // Handle deletion conflict (if vehicles use this category and relation is Restrict)
            if (error instanceof Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2003') { // Foreign key constraint failed
                    return next(new AppError('Não é possível excluir esta categoria pois ela está sendo usada por um ou mais veículos.', 409));
                }
                // P2025 (Record to delete does not exist) is handled by the check above or would cause a different error path
            }
            next(error);
        }
    }
);

export default vehicleCategoryRoutesController;