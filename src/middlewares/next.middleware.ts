import AppError from "utils/AppError";

export const next = (error: Error) => {
    // Re-throw AppErrors or handle other errors
    if (error instanceof AppError) throw error;
    // Handle specific Prisma errors if necessary (like unique constraints if check fails somehow)
    console.error("Register Error:", error);
    throw new AppError('Erro', 500); // Default internal error
}

export default next;