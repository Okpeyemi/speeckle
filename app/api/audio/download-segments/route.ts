import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import archiver from "archiver";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dir = searchParams.get("dir");

  if (!dir) {
    return NextResponse.json({ error: "Paramètre 'dir' manquant" }, { status: 400 });
  }

  // Sécurité : le dossier doit rester dans output/
  const outputBase = path.resolve(process.cwd(), "output");
  const resolvedDir = path.resolve(dir);

  if (!resolvedDir.startsWith(outputBase)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  if (!fs.existsSync(resolvedDir)) {
    return NextResponse.json({ error: "Dossier introuvable" }, { status: 404 });
  }

  const wavFiles = fs.readdirSync(resolvedDir).filter((f) => f.endsWith(".wav"));

  if (wavFiles.length === 0) {
    return NextResponse.json({ error: "Aucun segment trouvé dans ce dossier" }, { status: 404 });
  }

  // Nom du dossier de session pour nommer le ZIP
  const sessionName = path.basename(resolvedDir);

  // Créer le ZIP en mémoire via un PassThrough stream
  const archive = archiver("zip", { zlib: { level: 6 } });

  // Ajouter tous les fichiers WAV
  for (const file of wavFiles.sort()) {
    archive.file(path.join(resolvedDir, file), { name: file });
  }

  // Collecter les chunks dans un buffer
  const chunks: Buffer[] = [];

  archive.on("data", (chunk: Buffer) => chunks.push(chunk));

  await new Promise<void>((resolve, reject) => {
    archive.on("end", resolve);
    archive.on("error", reject);
    archive.finalize();
  });

  const zipBuffer = Buffer.concat(chunks);

  return new NextResponse(zipBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${sessionName}_segments.zip"`,
      "Content-Length": zipBuffer.length.toString(),
      "Cache-Control": "no-store",
    },
  });
}
