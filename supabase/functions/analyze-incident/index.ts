import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text } = await req.json();
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Text is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `You are an expert at analyzing incident reports and status updates for software services. Given an incident description or status update text, you must extract:

1. A concise incident title
2. The current incident status (investigating, identified, monitoring, or resolved)
3. The impact severity (major, partial, degraded, or maintenance)
4. A list of affected services/components mentioned or implied
5. A timeline of status updates if multiple updates are present in the text

For each affected service, determine its current status based on the incident:
- "major" = completely down/unavailable
- "partial" = partially working, some failures
- "degraded" = working but slow or reduced capacity
- "maintenance" = planned maintenance

If the text is vague about specific services, infer reasonable service names from context (e.g. "API", "Website", "Database", "Authentication", etc.).

If no timestamps are mentioned or can be inferred from the text, use the current date and time provided below for all timestamps.

You MUST use the extract_incident_data tool to return your analysis.`;

    const now = new Date().toISOString();
    const userPrompt = `Current date and time: ${now}\n\nAnalyze this incident report and extract the structured data:\n\n${text.slice(0, 10000)}`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0,
        tools: [
          {
            type: "function",
            function: {
              name: "extract_incident_data",
              description: "Extract structured incident data from the text",
              parameters: {
                type: "object",
                properties: {
                  title: { type: "string", description: "Concise incident title" },
                  status: {
                    type: "string",
                    enum: ["investigating", "identified", "monitoring", "maintenance", "resolved"],
                  },
                  impact: {
                    type: "string",
                    enum: ["major", "partial", "degraded", "maintenance"],
                  },
                  services: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        status: {
                          type: "string",
                          enum: ["operational", "degraded", "partial", "major", "maintenance"],
                        },
                      },
                      required: ["name", "status"],
                      additionalProperties: false,
                    },
                  },
                  updates: {
                    type: "array",
                    description: "Timeline of status updates, newest first",
                    items: {
                      type: "object",
                      properties: {
                        status: {
                          type: "string",
                          enum: ["investigating", "identified", "monitoring", "maintenance", "resolved"],
                        },
                        message: { type: "string" },
                        timestamp: {
                          type: "string",
                          description: "ISO 8601 timestamp if available, otherwise best guess based on context",
                        },
                      },
                      required: ["status", "message", "timestamp"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["title", "status", "impact", "services", "updates"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_incident_data" } },
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("AI error:", aiRes.status, errText);
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI analysis failed");
    }

    const aiData = await aiRes.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      throw new Error("No structured data returned from AI");
    }

    const extracted = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({ success: true, data: extracted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("analyze-incident error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
