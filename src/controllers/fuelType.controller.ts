// src/controllers/fuelType.controller.ts
import AppError from '../utils/AppError';
import { Prisma, PrismaClient } from '@prisma/client';

import {
    CreateFuelTypeInput,
    UpdateFuelTypeInput,
    FuelTypeIdParams,
    createFuelTypeSchema,
    fuelTypeIdParamSchema,
    updateFuelTypeSchema
} from '../validators/fuelType.validator';
import { AppEnv, Context } from 'hono';
import { PrismaD1 } from '@prisma/adapter-d1';
import { Hono } from 'hono';
import { protect } from 'middlewares/auth.middleware';
import { prismaMiddleware } from 'middlewares/prisma.middleware';
import { authorize } from 'middlewares/authorize.middleware';
import permissions from 'utils/permissions';
import { zValidator } from '@hono/zod-validator';
import next from 'middlewares/next.middleware';

const getPrisma = (c: Context<AppEnv>) => {
    const adapter = new PrismaD1(c.env.DB);
    const prisma = new PrismaClient({ adapter });
    if (!prisma) throw new AppError('Internal server configuration error (Prisma).', 500);
    return prisma;
}

const fuelTypeRoutesController = new Hono<AppEnv>();

// Apply common middleware
fuelTypeRoutesController.use('*', protect); // Protect all and ensure Prisma

// ==============================
// Fuel types Routes
// ==============================

fuelTypeRoutesController.post(
    '/',
    authorize([permissions.admin.create_any]),
    zValidator("json", createFuelTypeSchema.shape.body),
    async (c) => {
        const { name } = c.req.valid('json');
        try {
            const prisma = getPrisma(c);
            // Check if name already exists (case-insensitive recommended)
            const existing = await prisma.fuelType.findUnique({
                where: { name: name } // Case-sensitive default
                // where: { name: { equals: name, mode: 'insensitive' } } // Case-insensitive for PostgreSQL
            });
            if (existing) {
                return next(new AppError(`Tipo de combustível '${name}' já existe.`, 409));
            }

            const newFuelType = await prisma.fuelType.create({
                data: { name },
                select: { id: true, name: true, createdAt: true }
            });
            return c.json(newFuelType, 201);

        } catch (error) {
            // Handle potential race conditions or other DB errors
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                return next(new AppError(`Tipo de combustível '${name}' já existe (conflito).`, 409));
            }
            next(error);
        }
    }
);

fuelTypeRoutesController.get(
    '/',
    authorize([permissions.admin.read_any]),
    async (c) => {
        try {
            const prisma = getPrisma(c);
            const fuelTypes = await prisma.fuelType.findMany({
                orderBy: { name: 'asc' },
                select: { id: true, name: true } // Only return id and name for lists/selects
            });
            return c.json(fuelTypes);
        } catch (error) {
            next(error);
        }
    }
);

fuelTypeRoutesController.get(
    '/:fuelTypeId',
    authorize([permissions.admin.read_any]),
    zValidator('param', fuelTypeIdParamSchema.shape.params),
    async (c) => {
        const { fuelTypeId } = c.req.valid('param');
        try {
            const prisma = getPrisma(c);
            const fuelType = await prisma.fuelType.findUnique({
                where: { id: fuelTypeId },
                // Select fields needed for detailed view if different from list
                select: { id: true, name: true, createdAt: true, updatedAt: true }
            });

            if (!fuelType) {
                return next(new AppError(`Tipo de combustível com ID ${fuelTypeId} não encontrado.`, 404));
            }
            return c.json(fuelType);
        } catch (error) {
            next(error);
        }
    }
);

fuelTypeRoutesController.patch(
    '/:fuelTypeId',
    authorize([permissions.admin.update_any]),
    zValidator('param', updateFuelTypeSchema.shape.params),
    zValidator('json', updateFuelTypeSchema.shape.body),
    async (c) => {
        const { fuelTypeId } = c.req.valid('param');
        const { name } = c.req.valid('json'); // Only name can be updated based on schema

        try {
            const prisma = getPrisma(c);
            // Check if fuel type exists first
            const currentFuelType = await prisma.fuelType.findUnique({
                where: { id: fuelTypeId }, select: { id: true }
            });
            if (!currentFuelType) {
                return next(new AppError(`Tipo de combustível com ID ${fuelTypeId} não encontrado.`, 404));
            }

            // Check for name conflict (case-insensitive recommended)
            const nameConflict = await prisma.fuelType.findFirst({
                where: {
                    // name: name, // Case-sensitive
                    name: { equals: name }, // Case-insensitive for PostgreSQL
                    NOT: { id: fuelTypeId } // Exclude self
                },
                select: { id: true }
            });
            if (nameConflict) {
                return next(new AppError(`Tipo de combustível com nome '${name}' já existe.`, 409));
            }

            const updatedFuelType = await prisma.fuelType.update({
                where: { id: fuelTypeId },
                data: { name: name }, // Update only the name
                select: { id: true, name: true, createdAt: true, updatedAt: true }
            });
            return c.json(updatedFuelType);

        } catch (error) {
            // Handle potential race conditions or other DB errors
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                return next(new AppError(`Tipo de combustível com nome '${name}' já existe (conflito).`, 409));
            }
            // P2025 (Record to update not found) handled by initial check
            next(error);
        }
    }
);

fuelTypeRoutesController.delete(
    '/:fuelTypeId',
    authorize([permissions.admin.delete_any]),
    zValidator('param', fuelTypeIdParamSchema.shape.params),
    async (c) => {
        const { fuelTypeId } = c.req.valid('param');
        try {
            const prisma = getPrisma(c);
            // Check existence first (optional, delete throws P2025 if not found)
            const exists = await prisma.fuelType.findUnique({ where: { id: fuelTypeId }, select: { id: true } });
            if (!exists) {
                return next(new AppError(`Tipo de combustível com ID ${fuelTypeId} não encontrado.`, 404));
            }

            // Attempt to delete
            await prisma.fuelType.delete({
                where: { id: fuelTypeId }
            });
            return c.body(null, 204);

        } catch (error) {
            // Handle deletion conflict (if Fueling records use this type and relation is Restrict)
            if (error instanceof Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2003') { // Foreign key constraint failed
                    return next(new AppError('Não é possível excluir este tipo de combustível pois ele está sendo usado em um ou mais registros de abastecimento.', 409));
                }
            }
            next(error);
        }
    }
);

export default fuelTypeRoutesController;