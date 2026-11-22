"use client";

import * as React from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, Bar, BarChart, Line, LineChart } from "recharts";
import { useTranslation } from "react-i18next";

import { formatDate as formatDateI18n } from "@/lib/date-utils";
import { DEFAULT_TIME_RANGES } from "@/lib/constants/charts";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useIsMobile } from "@/hooks/use-mobile";

export interface TimeSeriesDataPoint {
  date: string;
  [key: string]: string | number;
}

export interface TimeSeriesChartProps {
  title: string;
  description?: string;
  data: TimeSeriesDataPoint[];
  dataKey: string;
  dataLabel?: string;
  type?: "area" | "line" | "bar";
  color?: string;
  showTimeRangeSelector?: boolean;
  timeRanges?: { value: string; label: string; days: number }[];
  height?: number;
  showYAxis?: boolean;
  valueFormatter?: (value: number) => string;
}

export function TimeSeriesChart({
  title,
  description,
  data,
  dataKey,
  dataLabel,
  type = "area",
  color = "var(--primary)",
  showTimeRangeSelector = false,
  timeRanges = DEFAULT_TIME_RANGES,
  height = 300,
  showYAxis = false,
  valueFormatter,
}: TimeSeriesChartProps) {
  const isMobile = useIsMobile();
  const { i18n } = useTranslation();
  const [timeRange, setTimeRange] = React.useState(timeRanges[0]?.value || "90d");

  React.useEffect(() => {
    if (isMobile && timeRanges.length > 0) {
      const shortestRange = timeRanges[timeRanges.length - 1];
      if (shortestRange) setTimeRange(shortestRange.value);
    }
  }, [isMobile, timeRanges]);

  const filteredData = React.useMemo(() => {
    if (!showTimeRangeSelector || !data.length) return data;

    const selectedRange = timeRanges.find((r) => r.value === timeRange);
    if (!selectedRange) return data;

    const latestDate = new Date(data[data.length - 1].date);
    const startDate = new Date(latestDate);
    startDate.setDate(startDate.getDate() - selectedRange.days);

    return data.filter((item) => new Date(item.date) >= startDate);
  }, [data, timeRange, timeRanges, showTimeRangeSelector]);

  const chartConfig = {
    [dataKey]: {
      label: dataLabel || dataKey,
      color,
    },
  } satisfies ChartConfig;

  const formatDate = (value: string) =>
    formatDateI18n(new Date(value), "MMM d", i18n.language);

  const formatTooltipDate = (value: string) =>
    formatDateI18n(new Date(value), "MMMM d, yyyy", i18n.language);

  const renderChart = () => {
    const commonProps = {
      data: filteredData,
    };

    const xAxisProps = {
      dataKey: "date",
      tickLine: false,
      axisLine: false,
      tickMargin: 8,
      minTickGap: 32,
      tickFormatter: formatDate,
    };

    const yAxisProps = showYAxis
      ? { tickLine: false, axisLine: false, width: 40 }
      : { hide: true };

    const tooltipContent = (
      <ChartTooltipContent
        labelFormatter={formatTooltipDate}
        formatter={
          valueFormatter
            ? (value) => valueFormatter(value as number)
            : undefined
        }
      />
    );

    if (type === "bar") {
      return (
        <BarChart {...commonProps}>
          <CartesianGrid vertical={false} />
          <XAxis {...xAxisProps} />
          <YAxis {...yAxisProps} />
          <ChartTooltip content={tooltipContent} />
          <Bar
            dataKey={dataKey}
            fill={`var(--color-${dataKey})`}
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      );
    }

    if (type === "line") {
      return (
        <LineChart {...commonProps}>
          <CartesianGrid vertical={false} />
          <XAxis {...xAxisProps} />
          <YAxis {...yAxisProps} />
          <ChartTooltip content={tooltipContent} />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={`var(--color-${dataKey})`}
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      );
    }

    return (
      <AreaChart {...commonProps}>
        <defs>
          <linearGradient id={`fill-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="5%"
              stopColor={`var(--color-${dataKey})`}
              stopOpacity={0.8}
            />
            <stop
              offset="95%"
              stopColor={`var(--color-${dataKey})`}
              stopOpacity={0.1}
            />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis {...xAxisProps} />
        <YAxis {...yAxisProps} />
        <ChartTooltip content={tooltipContent} />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={`var(--color-${dataKey})`}
          fill={`url(#fill-${dataKey})`}
        />
      </AreaChart>
    );
  };

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {showTimeRangeSelector && (
          <CardAction>
            <ToggleGroup
              type="single"
              value={timeRange}
              onValueChange={setTimeRange}
              variant="outline"
              className="hidden *:data-[slot=toggle-group-item]:!px-4 @[767px]/card:flex"
            >
              {timeRanges.map((range) => (
                <ToggleGroupItem key={range.value} value={range.value}>
                  {range.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger
                className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
                size="sm"
                aria-label="Select time range"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                {timeRanges.map((range) => (
                  <SelectItem
                    key={range.value}
                    value={range.value}
                    className="rounded-lg"
                  >
                    {range.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer
          config={chartConfig}
          className="w-full"
          style={{ height }}
        >
          {renderChart()}
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
