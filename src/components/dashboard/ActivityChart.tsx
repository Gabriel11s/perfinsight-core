import {
  ComposedChart, Bar, Line, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Brush,
} from 'recharts';

const tooltipStyle = {
  background: 'hsl(var(--card))',
  border: '1px solid hsl(var(--glass-border))',
  borderRadius: '12px',
  fontSize: 12,
  boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
  backdropFilter: 'blur(16px)',
  padding: '8px 12px',
};

interface DataPoint {
  label: string;
  fullLabel?: string;
  minutes: number;
  events: number;
}

interface ActivityChartProps {
  data: DataPoint[];
  height?: number;
  showBrush?: boolean;
  gradientId?: string;
  minutesColor?: string;
  eventsColor?: string;
}

export function ActivityChart({
  data,
  height = 280,
  showBrush = false,
  gradientId = 'chartGrad',
  minutesColor = 'hsl(199, 89%, 48%)',
  eventsColor = 'hsl(38, 92%, 50%)',
}: ActivityChartProps) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
          <defs>
            <linearGradient id={`${gradientId}Min`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={minutesColor} stopOpacity={0.2} />
              <stop offset="100%" stopColor={minutesColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="hsl(var(--border))"
            strokeDasharray="3 3"
            vertical={false}
            strokeOpacity={0.3}
          />
          <XAxis
            dataKey="label"
            minTickGap={24}
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(label, payload) => payload?.[0]?.payload?.fullLabel || label}
            cursor={{ fill: 'hsl(var(--primary) / 0.04)' }}
          />
          {/* Minutes as filled area + bars */}
          <Bar
            dataKey="minutes"
            name="Screen Time (min)"
            fill={minutesColor}
            fillOpacity={0.15}
            radius={[4, 4, 0, 0]}
            barSize={data.length > 15 ? 12 : 24}
          />
          <Area
            type="monotone"
            dataKey="minutes"
            name=""
            stroke="none"
            fill={`url(#${gradientId}Min)`}
            legendType="none"
            tooltipType="none"
          />
          {/* Events as line with dots */}
          <Line
            type="monotone"
            dataKey="events"
            name="GHL Events"
            stroke={eventsColor}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 5, strokeWidth: 2, fill: 'hsl(var(--card))' }}
          />
          {showBrush && data.length > 10 && (
            <Brush
              dataKey="label"
              height={28}
              stroke="hsl(var(--border))"
              fill="hsl(var(--card))"
              travellerWidth={8}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
