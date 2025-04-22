// src/types/hono.d.ts OR hono.d.ts
import 'hono'; // Import to ensure module augmentation works
import { Bindings, UserVariable, Variables } from 'types';

// Augment Hono's Context interface
declare module 'hono' {
    interface ContextVariableMap {
        user: UserVariable | undefined; // Make it optional
        // Define types for other variables if you add them
    }

    type AppEnv = {
        Bindings: Bindings;
        Variables: Variables;
    }
}

// Optional but helpful: Define a type alias for your App's specific context
// import { Context } from 'hono';
// export type AppContext = Context<{ Variables: Variables }>;