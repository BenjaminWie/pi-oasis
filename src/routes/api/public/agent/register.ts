import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonResponse, newDeviceToken } from "@/lib/ai/agent-api.server";

const Body = z.object({
  code: z.string().min(4).max(16),
  hostname: z.string().min(1).max(128).optional(),
});

export const Route = createFileRoute("/api/public/agent/register")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body;
        try {
          body = Body.parse(await request.json());
        } catch (e: any) {
          return jsonResponse({ error: "invalid body" }, 400);
        }

        const { data: device, error } = await supabaseAdmin
          .from("devices")
          .select("id, user_id, name, pairing_expires_at")
          .eq("pairing_code", body.code.toUpperCase())
          .maybeSingle();

        if (error || !device) {
          return jsonResponse({ error: "code unknown" }, 404);
        }
        if (device.pairing_expires_at && new Date(device.pairing_expires_at) < new Date()) {
          return jsonResponse({ error: "code expired" }, 410);
        }

        const { token, hash } = newDeviceToken();
        await supabaseAdmin
          .from("devices")
          .update({
            device_token_hash: hash,
            pairing_code: null,
            pairing_expires_at: null,
            name: body.hostname || device.name,
          })
          .eq("id", device.id);

        return jsonResponse({
          deviceId: device.id,
          deviceToken: token,
          name: body.hostname || device.name,
        });
      },
    },
  },
});
