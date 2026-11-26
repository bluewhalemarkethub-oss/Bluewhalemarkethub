import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import type { ShippingOrder } from '../types/marketplace';

type MetricMode = 'count' | 'spend';

interface DailyOrderVolumePoint {
  dateKey: string;
  shortLabel: string;
  fullLabel: string;
  orderCount: number;
  spendUsd: number;
}

interface OrderVolumeChartProps {
  orders: ShippingOrder[];
}

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function OrderVolumeChart({ orders }: OrderVolumeChartProps) {
  const [metric, setMetric] = useState<MetricMode>('count');

  const { series, totalOrders30d, totalSpend30d, peakDay } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const bucketMap = new Map<string, DailyOrderVolumePoint>();
    const orderedDays: DailyOrderVolumePoint[] = [];

    for (let offset = 29; offset >= 0; offset -= 1) {
      const d = new Date(today);
      d.setDate(today.getDate() - offset);
      const dateKey = toLocalDateKey(d);
      const point: DailyOrderVolumePoint = {
        dateKey,
        shortLabel: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        fullLabel: d.toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
        orderCount: 0,
        spendUsd: 0,
      };
      bucketMap.set(dateKey, point);
      orderedDays.push(point);
    }

    for (const order of orders) {
      const parsed = new Date(order.createdAt);
      if (Number.isNaN(parsed.getTime())) continue;
      const key = toLocalDateKey(parsed);
      const bucket = bucketMap.get(key);
      if (!bucket) continue;
      bucket.orderCount += 1;
      bucket.spendUsd = Number((bucket.spendUsd + Number(order.price || 0)).toFixed(2));
    }

    let sumOrders = 0;
    let sumSpend = 0;
    let peak: DailyOrderVolumePoint | null = null;
    for (const pt of orderedDays) {
      sumOrders += pt.orderCount;
      sumSpend += pt.spendUsd;
      if (!peak || pt.orderCount > peak.orderCount || (pt.orderCount === peak.orderCount && pt.spendUsd > peak.spendUsd)) {
        peak = pt;
      }
    }

    return {
      series: orderedDays,
      totalOrders30d: sumOrders,
      totalSpend30d: Number(sumSpend.toFixed(2)),
      peakDay: peak && peak.orderCount > 0 ? peak : null,
    };
  }, [orders]);

  const dataKey = metric === 'count' ? 'orderCount' : 'spendUsd';

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/60 shrink-0">
            <BarChart3 className="w-4 h-4" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Order Volume · Last 30 Days
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Daily breakdown of verified account purchases over the trailing 30-day window.
            </p>
          </div>
        </div>

        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setMetric('count')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              metric === 'count'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Orders
          </button>
          <button
            type="button"
            onClick={() => setMetric('spend')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              metric === 'spend'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Volume ($ USD)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="px-4 py-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800">
          <div className="text-[11px] font-medium text-slate-500">30-Day Orders</div>
          <div className="mt-1 font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-white">
            {totalOrders30d}
          </div>
        </div>
        <div className="px-4 py-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800">
          <div className="text-[11px] font-medium text-slate-500">30-Day Purchase Volume</div>
          <div className="mt-1 font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-white">
            ${totalSpend30d.toFixed(2)}
          </div>
        </div>
        <div className="px-4 py-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800">
          <div className="text-[11px] font-medium text-slate-500">Peak Order Day</div>
          <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-white truncate">
            {peakDay
              ? `${peakDay.shortLabel} (${peakDay.orderCount} · $${peakDay.spendUsd.toFixed(0)})`
              : 'No orders in 30d'}
          </div>
        </div>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="#94a3b8"
              strokeOpacity={0.22}
            />
            <XAxis
              dataKey="shortLabel"
              tick={{ fontSize: 11, fill: '#64748b' }}
              tickLine={false}
              axisLine={false}
              interval={4}
            />
            <YAxis
              allowDecimals={metric === 'spend'}
              tick={{ fontSize: 11, fill: '#64748b' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(val: number) => (metric === 'spend' ? `$${val}` : String(val))}
            />
            <Tooltip
              cursor={{ fill: '#3b82f6', fillOpacity: 0.08 }}
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const point = payload[0]?.payload as DailyOrderVolumePoint | undefined;
                if (!point) return null;
                return (
                  <div className="px-3 py-2 rounded-lg bg-slate-900 dark:bg-slate-950 text-white border border-slate-700 shadow-lg text-xs space-y-1">
                    <div className="font-semibold text-slate-200">{point.fullLabel}</div>
                    <div className="flex items-center justify-between gap-4 font-mono tabular-nums">
                      <span className="text-slate-400">Orders:</span>
                      <span className="font-semibold text-white">{point.orderCount}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4 font-mono tabular-nums">
                      <span className="text-slate-400">Volume:</span>
                      <span className="font-semibold text-blue-400">${point.spendUsd.toFixed(2)} USD</span>
                    </div>
                  </div>
                );
              }}
            />
            <Bar
              dataKey={dataKey}
              fill="#2563eb"
              radius={[4, 4, 0, 0]}
              maxBarSize={22}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
