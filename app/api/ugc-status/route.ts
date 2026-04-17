import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) must be set");
  }

  return createClient(url, key);
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("job_id");

  if (!jobId) {
    return NextResponse.json({ error: "Missing job_id parameter" }, { status: 400 });
  }

  try {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from("ugc_jobs")
      .select("*")
      .eq("job_id", jobId)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const BASE = "https://app.boostmybusinesses.com/webhook/ugc-feedback-link";

    return NextResponse.json({
      ...data,
      status: data.status,
      current_step: data.current_step,
      image_url: data.image_url,
      storage_path: data.storage_path,
      approve_url: `${BASE}?job_id=${data.job_id}&action=approve`,
      modify_url: `${BASE}?job_id=${data.job_id}&action=modify`,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to query Supabase",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
