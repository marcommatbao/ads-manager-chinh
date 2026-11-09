// GET /api/odoo/debug-categories
// Lists all product categories from Odoo with their IDs.
// Use this to verify category IDs in odoo-product-categories.ts.
// Remove or protect this endpoint before going to production.

import { NextResponse } from "next/server";
import { searchRead } from "@/lib/odoo-client";
import { getCurrentUser } from "@/lib/auth";
import { friendlyError } from "@/lib/not-configured";

interface OdooCategory {
  id: number;
  name: string;
  complete_name: string;
  parent_id: [number, string] | false;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const categories = await searchRead<OdooCategory>(
      "product.category",
      [],
      ["id", "name", "complete_name", "parent_id"],
      { limit: 200, order: "complete_name asc" }
    );

    return NextResponse.json({
      total: categories.length,
      categories: categories.map(c => ({
        id: c.id,
        name: c.name,
        complete_name: c.complete_name,
        parent: Array.isArray(c.parent_id) ? { id: c.parent_id[0], name: c.parent_id[1] } : null,
      })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: friendlyError(msg) }, { status: 500 });
  }
}
