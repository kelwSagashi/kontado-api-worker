// src/validators/note.validator.ts
import { z } from 'zod';

export const noteReminderBaseSchema = {
    title: z.string({ required_error: "Título é obrigatório." }).min(1, "Título não pode ser vazio."),
    note: z.string({ required_error: "Nota/Descrição é obrigatória." }).default(''),
    typeId: z.string({ required_error: "Tipo é obrigatório." }).uuid("ID do tipo inválido."),
    reminderDate: z.preprocess((arg) => {
        // Allow null, undefined, or valid date strings
        if (arg == null || arg === '') return null;
        const date = new Date(arg as string);
        return isNaN(date.getTime()) ? null : date;
      }, z.date().nullable().optional()), // Validate as date or null
    isRecurring: z.boolean().optional().default(false),
};

// Schema for Creating a Note/Reminder (associated with a vehicle)
export const createNoteSchema = z.object({
    params: z.object({
        vehicleId: z.string().uuid("ID do veículo inválido."),
    }),
    body: z.object(noteReminderBaseSchema),
});

// Schema for common Note ID param
export const noteIdParamSchema = z.object({
    params: z.object({
        noteId: z.string().uuid("ID da nota/lembrete inválido."),
    }),
});

// Schema for common Todo ID param
const todoIdParamSchema = z.object({
     todoId: z.string().uuid("ID da tarefa inválido."),
});

// Schema for Updating a Note/Reminder
export const updateNoteSchema = z.object({
    params: noteIdParamSchema.shape.params, // Reuse noteId param
    body: z.object({ // All fields optional for PATCH
        title: noteReminderBaseSchema.title.optional(),
        note: noteReminderBaseSchema.note.optional(),
        typeId: noteReminderBaseSchema.typeId.optional(),
        reminderDate: noteReminderBaseSchema.reminderDate, // Already optional and nullable
        isRecurring: noteReminderBaseSchema.isRecurring.optional(),
    }).refine(data => Object.keys(data).length > 0, {
        message: "Pelo menos um campo deve ser fornecido para atualização.",
    }),
});

// Schema for Listing Notes (associated with a vehicle)
export const listNotesSchema = z.object({
    params: z.object({
        vehicleId: z.string().uuid("ID do veículo inválido."),
    }),
    // Add query params for filtering if needed (e.g., by type, date range)
    // query: z.object({ typeId: z.string().uuid().optional() })
});


// --- Todo Schemas ---

// Schema for Adding a Todo
export const addTodoSchema = z.object({
    params: noteIdParamSchema.shape.params, // Belongs to a note
    body: z.object({
        name: z.string({ required_error: "Nome da tarefa é obrigatório."}).min(1),
    }),
});

// Schema for Updating a Todo
export const updateTodoSchema = z.object({
    params: noteIdParamSchema.shape.params.merge(todoIdParamSchema), // Needs noteId and todoId
    body: z.object({
        name: z.string().min(1).optional(),
        isComplete: z.boolean().optional(),
    }).refine(data => Object.keys(data).length > 0, {
        message: "Pelo menos um campo (name ou isComplete) deve ser fornecido.",
    }),
});

// Schema for Deleting a Todo
export const deleteTodoSchema = z.object({
    params: noteIdParamSchema.shape.params.merge(todoIdParamSchema),
});


// Types for Controller
export type CreateNoteInput = z.infer<typeof createNoteSchema>['body'];
export type CreateNoteParams = z.infer<typeof createNoteSchema>['params'];
export type ListNotesParams = z.infer<typeof listNotesSchema>['params'];
export type NoteIdParams = z.infer<typeof noteIdParamSchema>['params'];
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>['body'];
export type AddTodoInput = z.infer<typeof addTodoSchema>['body'];
export type AddTodoParams = z.infer<typeof addTodoSchema>['params'];
export type UpdateTodoInput = z.infer<typeof updateTodoSchema>['body'];
export type UpdateTodoParams = z.infer<typeof updateTodoSchema>['params'];
export type DeleteTodoParams = z.infer<typeof deleteTodoSchema>['params'];