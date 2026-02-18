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
    const { imageBase64, imageUrl } = await req.json();
    if (!imageBase64 && !imageUrl) {
      return new Response(JSON.stringify({ error: "An image (base64 or URL) is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `You are an expert at analyzing system architecture and infrastructure diagrams. Given an image of a system diagram, network topology, or infrastructure architecture, extract ALL services, components, and systems visible in the diagram.

For each service/component found, determine a reasonable operational status. Since this is a new status page setup, default all services to "operational" unless the diagram clearly indicates otherwise.

Group related services when there's a clear hierarchy (e.g. "API" might have sub-services like "REST API", "GraphQL API").

Be thorough - extract every distinct service, database, queue, cache, load balancer, CDN, etc. that appears in the diagram.

You MUST use the extract_services tool to return your analysis.`;

    const userContent: any[] = [
      { type: "text", text: "Analyze this system diagram and extract all services and components:" },
    ];

    let finalBase64 = imageBase64;
    let mimeType = "image/png";

    if (!finalBase64 && imageUrl) {
      // Fetch the image server-side to handle SVGs, redirects, etc.
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) {
        return new Response(JSON.stringify({ error: `Failed to fetch image from URL (${imgRes.status})` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const contentType = imgRes.headers.get("content-type") || "";
      // Reject non-image content
      if (!contentType.startsWith("image/")) {
        return new Response(JSON.stringify({ error: `URL did not return an image (got ${contentType})` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      mimeType = contentType.split(";")[0].trim();
      // Gemini does not support SVG — reject early with a clear message
      if (mimeType === "image/svg+xml") {
        return new Response(JSON.stringify({ error: "SVG images are not supported. Please use a PNG, JPEG, or WebP image instead." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const arrayBuf = await imgRes.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      finalBase64 = btoa(binary);
    }

    if (finalBase64) {
      // Detect mime from base64 header if not already set from fetch
      if (imageBase64) {
        if (finalBase64.startsWith("/9j/")) mimeType = "image/jpeg";
        else if (finalBase64.startsWith("iVBOR")) mimeType = "image/png";
        else if (finalBase64.startsWith("R0lGOD")) mimeType = "image/gif";
        else if (finalBase64.startsWith("UklGR")) mimeType = "image/webp";
      }
      userContent.push({
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${finalBase64}` },
      });
    }

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0,
        tools: [
          {
            type: "function",
            function: {
              name: "extract_services",
              description: "Extract services and components from the system diagram",
              parameters: {
                type: "object",
                properties: {
                  organization: {
                    type: "string",
                    description: "Name of the organization if visible in the diagram, or empty string",
                  },
                  services: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string", description: "Service or component name" },
                        status: {
                          type: "string",
                          enum: ["operational", "degraded", "partial", "major", "maintenance"],
                          description: "Default to operational unless diagram indicates otherwise",
                        },
                        group: {
                          type: "string",
                          description: "Optional group/category name for hierarchical organization",
                        },
                      },
                      required: ["name", "status"],
                      additionalProperties: false,
                    },
                  },
                  summary: {
                    type: "string",
                    description: "Brief one-line summary of the system architecture",
                  },
                },
                required: ["organization", "services", "summary"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_services" } },
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
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 400) {
        try {
          const parsed = JSON.parse(errText);
          const msg = parsed?.error?.message || "The image could not be processed. Try a different format (PNG, JPEG, WebP).";
          return new Response(JSON.stringify({ error: msg }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch { /* fall through */ }
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
    console.error("analyze-diagram error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
