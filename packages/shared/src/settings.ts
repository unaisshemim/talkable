import { z } from "zod";

const localHostnamePattern =
  /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)$/;

export const BackendUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        localHostnamePattern.test(url.hostname)
      );
    } catch {
      return false;
    }
  }, "Backend URL must be a local HTTP or HTTPS URL.");

export const SettingsSchema = z.object({
  backendUrl: BackendUrlSchema.default("http://127.0.0.1:4317"),
  projectPath: z.string().min(1, "Project path is required."),
  codexThreadId: z.string().min(1).optional(),
  audioInputDeviceId: z.string().min(1).optional()
});

export type Settings = z.infer<typeof SettingsSchema>;
