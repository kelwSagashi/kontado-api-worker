// src/controllers/note.controller.ts
import AppError from '../utils/AppError';
import { Prisma, PrismaClient } from '@prisma/client';

// Import types from validator
import {
    CreateNoteInput, CreateNoteParams,
    ListNotesParams,
    NoteIdParams, UpdateNoteInput,
    AddTodoInput, AddTodoParams,
    UpdateTodoInput, UpdateTodoParams,
    DeleteTodoParams,
    createNoteSchema,
    noteReminderBaseSchema,
    noteIdParamSchema,
    listNotesSchema,
    updateNoteSchema,
    addTodoSchema,
    updateTodoSchema,
    deleteTodoSchema,
} from '../validators/note.validator';
import { protect } from 'middlewares/auth.middleware';
import { AppEnv, Context, Hono } from 'hono';
import { authorize } from 'middlewares/authorize.middleware';
import permissions from 'utils/permissions';
import { zValidator } from '@hono/zod-validator';
import vehicleRoutesController, { checkVehicleAccess } from './vehicle.controller';
import next from 'middlewares/next.middleware';
import { PrismaD1 } from '@prisma/adapter-d1';
import { z } from 'zod';

// --- Helper Function for Note Access ---
/**
 * Checks if a user has access to a note via its associated vehicle.
 * Throws AppError (404/403) if note/vehicle not found or access denied.
 */
async function checkNoteAccess(prisma: PrismaClient, userId: string, noteId: string): Promise<Prisma.NoteReminderGetPayload<{ include: { vehicle: { select: { id: true } } } }>> {
    const note = await prisma.noteReminder.findUnique({
        where: { id: noteId },
        include: {
            vehicle: { // Need vehicle to check its owner/authorized users
                select: {
                    id: true, // Include vehicle ID for potential further use
                    ownerId: true,
                    authorizedUsers: { // Efficiently check if user is authorized
                        where: { userId: userId },
                        select: { userId: true }
                    }
                }
            }
        }
    });

    if (!note) {
        throw new AppError(`Nota/Lembrete com ID ${noteId} não encontrado(a).`, 404);
    }
    if (!note.vehicle) {
        // Data integrity issue, should not happen with required relation
        console.error(`NoteReminder ${noteId} is missing its associated vehicle!`);
        throw new AppError('Erro interno ao verificar acesso à nota.', 500);
    }

    const isOwner = note.vehicle.ownerId === userId;
    const isAuthorized = note.vehicle.authorizedUsers.length > 0;

    if (!isOwner && !isAuthorized) {
        throw new AppError('Acesso proibido a esta nota/lembrete.', 403);
    }

    // Note: The returned note object still contains vehicle relation data here
    return note;
}

// --- Note/Reminder Controllers ---
const getPrisma = (c: Context<AppEnv>) => {
    const adapter = new PrismaD1(c.env.DB);
    const prisma = new PrismaClient({ adapter });
    if (!prisma) throw new AppError('Internal server configuration error (Prisma).', 500);
    return prisma;
}

const noteRoutesController = new Hono<AppEnv>();

// Apply common middleware
noteRoutesController.use('*', protect); // Protect all and ensure Prisma

// ==============================
// Note Routes
// ==============================

noteRoutesController.post(
    '/',
    authorize([permissions.note.create]),
    zValidator('param', createNoteSchema.shape.params),
    zValidator('json', z.object(noteReminderBaseSchema)),
    async (c) => {
        const userId = c.get('user').id; // Creator
        const { vehicleId } = c.req.valid('param');
        const data = c.req.valid('json');

        try {
            const prisma = getPrisma(c);
            // 1. Check user has access to the target vehicle
            const hasAccess = await checkVehicleAccess(prisma, userId, vehicleId);
            if (!hasAccess) {
                // Handle case where vehicle might not exist separately if needed
                return next(new AppError('Acesso negado ou veículo não encontrado.', 403));
            }

            // 2. Validate TypeId exists
            const typeExists = await prisma.noteReminderType.findUnique({
                where: { id: data.typeId }, select: { id: true },
            });
            if (!typeExists) {
                return next(new AppError(`Tipo de nota/lembrete com ID ${data.typeId} não encontrado.`, 404));
            }

            // 3. Create NoteReminder
            const newNote = await prisma.noteReminder.create({
                data: {
                    ...data,
                    reminderDate: data.reminderDate ? new Date(data.reminderDate) : null, // Ensure date conversion if needed
                    userId: userId,
                    vehicleId: vehicleId,
                } as any,
                include: { // Include related data in response
                    type: true,
                    user: { select: { id: true, username: true } },
                    _count: { select: { todos: true } }
                }
            });

            return c.json(newNote, 201);

        } catch (error) {
            next(error);
        }
    }
);

vehicleRoutesController.get(
    '/:vehicleId/notes',
    authorize([permissions.note.read]),
    zValidator('param', listNotesSchema.shape.params),
    async (c) => {
        const userId = c.get('user')!.id;
        const { vehicleId } = c.req.valid('param');
        // const { typeId } = req.query; // Example filtering

        try {
            const prisma = getPrisma(c);
            // 1. Check user has access to the target vehicle
            const hasAccess = await checkVehicleAccess(prisma, userId, vehicleId);
            if (!hasAccess) {
                return next(new AppError('Acesso negado ou veículo não encontrado.', 403));
            }

            // 2. Fetch notes
            const notes = await prisma.noteReminder.findMany({
                where: {
                    vehicleId: vehicleId,
                    // ...(typeId && { typeId: typeId as string }) // Apply filter if present
                },
                orderBy: { createdAt: 'desc' },
                include: {
                    type: { select: { name: true, iconName: true } },
                    user: { select: { id: true, username: true } }, // Creator info
                    _count: { select: { todos: true } } // Count of todos
                }
            });

            return c.json(notes);

        } catch (error) {
            next(error);
        }
    }
);

noteRoutesController.get(
    '/:noteId',
    authorize([permissions.note.read]),
    zValidator('param', noteIdParamSchema.shape.params),
    async (c) => {
        const userId = c.get('user').id;
        const { noteId } = c.req.valid('param');
        try {
            const prisma = getPrisma(c);
            // Checks access and existence
            await checkNoteAccess(prisma, userId, noteId);

            // Fetch full details including todos
            const note = await prisma.noteReminder.findUnique({
                where: { id: noteId },
                include: {
                    type: true,
                    user: { select: { id: true, username: true } },
                    vehicle: { select: { id: true, alias: true, plate: true } }, // Basic vehicle info
                    todos: { // Include todos list
                        orderBy: { createdAt: 'asc' }
                    }
                }
            });
            // Should exist because checkNoteAccess passed, but check again just in case
            if (!note) return next(new AppError(`Nota/Lembrete com ID ${noteId} não encontrado(a).`, 404));

            return c.json(note);
        } catch (error) {
            next(error); // Handles AppError from checkNoteAccess (404/403)
        }
    }
);

noteRoutesController.patch(
    '/:noteId',
    authorize([permissions.note.update]),
    zValidator('param', updateNoteSchema.shape.params),
    zValidator('json', updateNoteSchema.shape.body),
    async (c) => {
        const userId = c.get('user').id;
        const { noteId } = c.req.valid('param');
        const dataToUpdate = c.req.valid('json');

        try {
            const prisma = getPrisma(c);
            // 1. Check access and existence
            await checkNoteAccess(prisma, userId, noteId);

            // 2. Validate new TypeId if provided
            if (dataToUpdate.typeId) {
                const typeExists = await prisma.noteReminderType.findUnique({
                    where: { id: dataToUpdate.typeId }, select: { id: true },
                });
                if (!typeExists) {
                    return next(new AppError(`Tipo de nota/lembrete com ID ${dataToUpdate.typeId} não encontrado.`, 404));
                }
            }

            // 3. Prepare data (handle date)
            const preparedData = {
                ...dataToUpdate,
                reminderDate: dataToUpdate.reminderDate !== undefined
                    ? (dataToUpdate.reminderDate ? new Date(dataToUpdate.reminderDate) : null)
                    : undefined, // Keep undefined if not present in request
            };

            // 4. Update NoteReminder
            const updatedNote = await prisma.noteReminder.update({
                where: { id: noteId },
                data: preparedData,
                include: {
                    type: true,
                    user: { select: { id: true, username: true } },
                    _count: { select: { todos: true } }
                }
            });

            return c.json(updatedNote);

        } catch (error) {
            next(error);
        }
    }
);

noteRoutesController.delete(
    '/:noteId',
    authorize([permissions.note.delete]),
    zValidator('param', noteIdParamSchema.shape.params),
    async (c) => {
        const userId = c.get('user').id;
        const { noteId } = c.req.valid('param');

        try {
            const prisma = getPrisma(c);
            // 1. Check access and existence
            await checkNoteAccess(prisma, userId, noteId);

            // 2. Delete the note (Prisma cascade should delete related Todos)
            await prisma.noteReminder.delete({
                where: { id: noteId },
            });

            return c.status(204);

        } catch (error) {
            // Catch potential cascade constraint issues if any relation is Restrict
            next(error);
        }
    }
);


// --- Todo Controllers ---

noteRoutesController.post(
    '/:noteId/todos',
    authorize([permissions.todo.manage]), // Single permission for todo management
    zValidator('param', addTodoSchema.shape.params),
    zValidator('json', addTodoSchema.shape.body),
    async (c) => {
        const userId = c.get('user').id;
        const { noteId } = c.req.valid('param');
        const { name } = c.req.valid('json');

        try {
            const prisma = getPrisma(c);
            // 1. Check user has access to the parent note
            await checkNoteAccess(prisma, userId, noteId);

            // 2. Create Todo
            const newTodo = await prisma.todo.create({
                data: {
                    name: name,
                    noteReminderId: noteId, // Link to the parent note
                }
            });

            return c.json(newTodo);

        } catch (error) {
            next(error);
        }
    }
);


noteRoutesController.patch(
    '/:noteId/todos/:todoId',
    authorize([permissions.todo.manage]),
    zValidator('param', updateTodoSchema.shape.params),
    zValidator('json', updateTodoSchema.shape.body),
    async (c) => {
        const userId = c.get('user').id;
        const { noteId, todoId } = c.req.valid('param')
        const dataToUpdate = c.req.valid('json'); // Contains name? and/or isComplete?

        try {
            const prisma = getPrisma(c);
            // 1. Check user has access to the parent note (implicitly checks note existence)
            await checkNoteAccess(prisma, userId, noteId);

            // 2. Update the todo, but ensure it belongs to the correct note
            const updatedTodo = await prisma.todo.updateMany({ // Use updateMany to include noteId in where
                where: {
                    id: todoId,
                    noteReminderId: noteId // Ensures we only update if todo belongs to the specified note
                },
                data: dataToUpdate,
            });

            // updateMany returns a count. Check if any record was updated.
            if (updatedTodo.count === 0) {
                // Could be because todoId doesn't exist OR it doesn't belong to noteId
                const todoExists = await prisma.todo.findUnique({ where: { id: todoId }, select: { id: true } });
                if (todoExists) {
                    // Todo exists but doesn't belong to this note
                    return next(new AppError(`Tarefa com ID ${todoId} não pertence à nota ${noteId}.`, 400));
                } else {
                    return next(new AppError(`Tarefa com ID ${todoId} não encontrada.`, 404));
                }
            }

            // Fetch the updated todo to return it
            const todo = await prisma.todo.findUnique({ where: { id: todoId } });

            return c.json(todo);

        } catch (error) {
            next(error);
        }
    }
);

noteRoutesController.delete(
    '/:noteId/todos/:todoId',
    authorize([permissions.todo.manage]),
    zValidator('param', deleteTodoSchema.shape.params),
    async (c) => {
        const userId = c.get('user')!.id;
        const { noteId, todoId } = c.req.valid('param');

        try {
            const prisma = getPrisma(c);
            // 1. Check user has access to the parent note
            await checkNoteAccess(prisma, userId, noteId);

            // 2. Delete the todo, ensuring it belongs to the correct note
            const deleteResult = await prisma.todo.deleteMany({
                where: {
                    id: todoId,
                    noteReminderId: noteId // Ensures we only delete if todo belongs to the specified note
                }
            });

            // deleteMany returns a count. Check if any record was deleted.
            if (deleteResult.count === 0) {
                // Could be because todoId doesn't exist OR it doesn't belong to noteId
                const todoExists = await prisma.todo.findUnique({ where: { id: todoId }, select: { id: true } });
                if (todoExists) {
                    return next(new AppError(`Tarefa com ID ${todoId} não pertence à nota ${noteId}.`, 400));
                } else {
                    return next(new AppError(`Tarefa com ID ${todoId} não encontrada.`, 404));
                }
            }

            return c.body(null, 204);

        } catch (error) {
            next(error);
        }
    }
);

noteRoutesController.get(
    '/types',
    authorize([permissions.note.read]), // Controller will check specific access
    async (c) => {
        try {
            const prisma = getPrisma(c);
            const types = await prisma.noteReminderType.findMany({
                orderBy: { name: 'asc' },
                select: { id: true, name: true, iconName: true, createdAt: true, updatedAt: true } // Select fields for list
            });
            return c.json(types);
        } catch (error) {
            next(error);
        }
    }
);

export default noteRoutesController;