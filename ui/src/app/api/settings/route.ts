import { getModelCatalog, modelCatalogError } from "@/server/model-catalog";
import { readGlobalSettings, writeGlobalSettings } from "@/server/global-settings";

export const runtime = "nodejs";

export async function GET() {
  const settings = readGlobalSettings();
  try {
    return Response.json({ ...settings, models: await getModelCatalog(), catalog: { status: "ready" } });
  } catch (error) {
    return Response.json({
      ...settings,
      models: [],
      catalog: modelCatalogError(error),
    });
  }
}

export async function PUT(request: Request) {
  const data = await request.json() as { defaultModel?: unknown };
  try {
    if (typeof data.defaultModel !== "string") throw new Error("Default model is required");
    return Response.json(await writeGlobalSettings(data.defaultModel));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save global settings" }, { status: 400 });
  }
}
