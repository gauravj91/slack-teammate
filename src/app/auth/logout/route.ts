import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { appUrl } from "@/lib/config";

export async function POST() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${appUrl()}/`, { status: 303 });
}
