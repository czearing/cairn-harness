import { selectFolder } from "@/server/folder-picker";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const data = await request.json() as { initial?: string };
  try {
    return Response.json({ path: selectFolder(data.initial || "") });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Folder selection failed" }, { status: 500 });
  }
}
