import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dir = searchParams.get("dir");
  const file = searchParams.get("file");

  if (!dir || !file) {
    return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });
  }

  // Prevent path traversal: resolve must stay within output/
  const outputBase = path.resolve(process.cwd(), "output");
  const resolvedDir = path.resolve(dir);

  if (!resolvedDir.startsWith(outputBase)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Use basename to prevent directory traversal in file param
  const filePath = path.join(resolvedDir, path.basename(file));

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Fichier non trouvé" }, { status: 404 });
  }

  const buffer = fs.readFileSync(filePath);
  const range = request.headers.get("range");

  if (range) {
    const [startStr, endStr] = range.replace("bytes=", "").split("-");
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : buffer.length - 1;
    const chunk = buffer.subarray(start, end + 1);

    return new NextResponse(chunk, {
      status: 206,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Range": `bytes ${start}-${end}/${buffer.length}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunk.length.toString(),
      },
    });
  }

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": buffer.length.toString(),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
    },
  });
}
