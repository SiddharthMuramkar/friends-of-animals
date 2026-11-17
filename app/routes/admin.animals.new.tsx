// TODO(auth): Admin routes are UNPROTECTED. Anyone can view and create
// animals. Add authentication + an authorization check in every admin
// loader/action (e.g. require a Staff/Admin user) before deploying.
import { Form, redirect, useNavigation } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/admin.animals.new";
import { AdminBanner } from "~/components/admin-banner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { AnimalStatus } from "~/db/enums";
import { SITE } from "~/lib/site";
import {
  getStorage,
  isAllowedImageType,
  makeUploadKey,
  MAX_UPLOAD_BYTES,
} from "~/lib/storage/index.server";
import { parseFormData } from "~/lib/validation";
import { createAnimal } from "~/services/animalService";

export function meta({}: Route.MetaArgs) {
  return [{ title: `Admin · New animal | ${SITE.name}` }];
}

const SEXES = ["female", "male", "unknown"] as const;

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);
const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

const animalFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  species: z.string().trim().min(1, "Species is required").max(50),
  breed: optionalText(100),
  ageMonths: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ invalid_type_error: "Age must be a number" })
      .int("Age must be a whole number of months")
      .min(0)
      .max(600)
      .optional(),
  ),
  sex: z.preprocess(emptyToUndefined, z.enum(SEXES).optional()),
  status: z.nativeEnum(AnimalStatus),
  description: optionalText(5000),
});

type FieldErrors = Partial<Record<keyof z.infer<typeof animalFormSchema> | "photo", string>>;

function validatePhoto(value: FormDataEntryValue | null): string | File | null {
  if (!(value instanceof File) || value.size === 0) return null; // optional
  if (!isAllowedImageType(value.type)) return "Photo must be a JPEG, PNG, WebP, GIF or AVIF image";
  if (value.size > MAX_UPLOAD_BYTES) {
    return `Photo must be ${MAX_UPLOAD_BYTES / 1024 / 1024} MB or smaller`;
  }
  return value;
}

export async function action({ request }: Route.ActionArgs) {
  // Parses the multipart body in memory; MAX_UPLOAD_BYTES is enforced below.
  // For large uploads, consider a streaming multipart parser instead.
  const formData = await request.formData();
  const parsed = parseFormData(formData, animalFormSchema);
  const photo = validatePhoto(formData.get("photo"));

  const errors: FieldErrors = parsed.success ? {} : { ...parsed.errors };
  if (typeof photo === "string") errors.photo = photo;
  if (!parsed.success || typeof photo === "string") {
    return { errors };
  }

  let photoKey: string | null = null;
  if (photo) {
    const stored = await getStorage().put(makeUploadKey("animals", photo.name), photo, {
      contentType: photo.type,
    });
    photoKey = stored.key;
  }

  const animal = await createAnimal({ ...parsed.data, photoKey });
  return redirect(`/animals/${animal.id}`);
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-sm text-destructive">{message}</p> : null;
}

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs dark:bg-input/30";

export default function NewAnimal({ actionData }: Route.ComponentProps) {
  const errors: FieldErrors = actionData?.errors ?? {};
  const submitting = useNavigation().state === "submitting";

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <AdminBanner />
      <h1 className="text-2xl font-bold tracking-tight">New animal</h1>

      <Form method="post" encType="multipart/form-data" className="mt-6 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required aria-invalid={!!errors.name} />
          <FieldError message={errors.name} />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="species">Species</Label>
            <Input id="species" name="species" placeholder="dog, cat, rabbit…" required aria-invalid={!!errors.species} />
            <FieldError message={errors.species} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="breed">Breed</Label>
            <Input id="breed" name="breed" aria-invalid={!!errors.breed} />
            <FieldError message={errors.breed} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ageMonths">Age (months)</Label>
            <Input id="ageMonths" name="ageMonths" type="number" min={0} max={600} aria-invalid={!!errors.ageMonths} />
            <FieldError message={errors.ageMonths} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sex">Sex</Label>
            <select id="sex" name="sex" defaultValue="" className={selectClass}>
              <option value="">—</option>
              {SEXES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <FieldError message={errors.sex} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <select id="status" name="status" defaultValue={AnimalStatus.Available} className={selectClass}>
              {Object.values(AnimalStatus).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <FieldError message={errors.status} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="photo">Photo</Label>
            <Input id="photo" name="photo" type="file" accept="image/*" aria-invalid={!!errors.photo} />
            <FieldError message={errors.photo} />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" name="description" rows={5} aria-invalid={!!errors.description} />
          <FieldError message={errors.description} />
        </div>

        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Create animal"}
        </Button>
      </Form>
    </div>
  );
}
