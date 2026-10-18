import { connection } from "next/server";
import { buildWorkbook } from "@/lib/sheet";

// Download the spreadsheet, freshly built from the database.
export async function GET() {
  await connection();
  const buf = await buildWorkbook().xlsx.writeBuffer();
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="Post Categories ${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
