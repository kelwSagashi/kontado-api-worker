export type Bindings = {DB: D1Database}

// Define the structure of the 'user' object we'll set in the context
export type UserVariable = {
    id: string;
    roleId: string;
    // Add other fields from JWT payload if needed
};

// Define the structure of variables available in c.var
export type Variables = {
    user?: UserVariable; // Make it optional as it's only set after 'protect'
    // Add other potential variables here if needed
};

export type AuthVariables = {
    Bindings: Bindings;
    Variables: Variables;
};