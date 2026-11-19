export type ProfileField = {
  id: number;
  type: number;
  name: string;
  hint?: string;
  order: number;
  editable_by_user?: boolean;
  required?: boolean;
  field_data?: string | Record<string, { text?: string; order?: string }>;
};
export function fieldChoices(field: ProfileField): [string, string][] {
  try {
    const data =
      typeof field.field_data === "string"
        ? JSON.parse(field.field_data)
        : field.field_data;
    return Object.entries(data || {})
      .sort(
        ([, a], [, b]) =>
          Number((a as { order?: string }).order || 0) -
          Number((b as { order?: string }).order || 0),
      )
      .map(([id, value]) => [
        id,
        String((value as { text?: string }).text || id),
      ]);
  } catch {
    return [];
  }
}
export function profileChanges(
  fields: ProfileField[],
  before: Record<string, string>,
  after: Record<string, string>,
) {
  return fields
    .filter(
      (field) =>
        field.editable_by_user !== false &&
        field.type >= 1 &&
        field.type <= 8 &&
        (before[field.id] || "") !== (after[field.id] || ""),
    )
    .map((field) => ({
      id: field.id,
      value: after[field.id]
        ? field.type === 6
          ? (JSON.parse(after[field.id]) as number[])
          : after[field.id]
        : null,
    }));
}
