import { PrismaD1 } from "@prisma/adapter-d1";
import { DefaultArgs } from "@prisma/client/runtime/library";

export type Bindings = {
    DB: D1Database,
    JWT_SECRET: string,
    JWT_EXPIRES_IN: string,
}

// Define the structure of the 'user' object we'll set in the context
export type UserVariable = {
    id: string;
    roleId: string;
    // Add other fields from JWT payload if needed
};

// Define the structure of variables available in c.var
export type Variables = {
    user?: UserVariable; // Make it optional as it's only set after 'protect'
    prisma?: PrismaClient<{
        adapter: PrismaD1;
    }, never, DefaultArgs>;
    // Add other potential variables here if needed
};

export type AuthVariables = {
    Bindings: Bindings;
    Variables: Variables;
};