"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ConversionTimelinePoint } from "./page";

export default function ConversionTimelineChart({ data }: { data: ConversionTimelinePoint[] }) {
  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 12, left: -18, bottom: 4 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "rgba(255,255,255,0.48)", fontSize: 12 }}
          />
          <YAxis
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "rgba(255,255,255,0.48)", fontSize: 12 }}
          />
          <Tooltip
            contentStyle={{
              border: "1px solid rgba(255,255,255,0.10)",
              background: "#07111f",
              borderRadius: 12,
              color: "#f0f0ef",
              boxShadow: "0 18px 55px rgba(0,0,0,0.26)",
            }}
            labelStyle={{ color: "#FBBF24", fontWeight: 800 }}
          />
          <Line type="monotone" dataKey="links_sent" name="Links Sent" stroke="#F59E0B" strokeWidth={3} dot={false} activeDot={{ r: 5 }} />
          <Line type="monotone" dataKey="clicks" name="Clicks" stroke="#34D399" strokeWidth={3} dot={false} activeDot={{ r: 5 }} />
          <Line type="monotone" dataKey="bookings" name="Bookings" stroke="#93C5FD" strokeWidth={3} dot={false} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
