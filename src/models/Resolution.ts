import { z } from "zod";

export const ResolutionSchema = z.object({
  numero: z.coerce.number().int().positive(),
  numeroExpediente: z.string().min(1),
  administrado: z.string().min(1),
  unidadFiscalizable: z.string().min(1),
  sector: z.string().min(1),
  numeroResolucion: z.string().min(1),
  uuid: z.string().uuid(),
  pdfButtonId: z.string().min(1),
});

export type ResolutionRow = z.infer<typeof ResolutionSchema>;
