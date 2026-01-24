"use client";

import * as React from "react";
import { Pie, PieChart, Cell, Bar, BarChart, XAxis, YAxis } from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";

export interface DistributionDataPoint {
  name: string;
  value: number;
  color?: string;
}

export interface DistributionChartProps {
  /** Chart title */
  title: string;
  /** Chart description */
  description?: string;
  /** Data points with name and value */
  data: DistributionDataPoint[];
  /** Chart type: pie, donut, or bar */
  type?: "pie" | "donut" | "bar";
  /** Show legend */
  showLegend?: boolean;
  /** Height of the chart */
  height?: number;
  /** Default colors if not provided in data */
  colors?: string[];
}

const defaultColors = [
  "var(--primary)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export function DistributionChart({
  title,
  description,
  data,
  type = "donut",
  showLegend = true,
  height = 300,
  colors = defaultColors,
}: DistributionChartProps) {
  const chartConfig = React.useMemo(() => {
    const config: ChartConfig = {};
    data.forEach((item, index) => {
      config[item.name] = {
        label: item.name,
        color: item.color || colors[index % colors.length],
      };
    });
    return config;
  }, [data, colors]);

  const dataWithColors = React.useMemo(() => {
    return data.map((item, index) => ({
      ...item,
      fill: item.color || colors[index % colors.length],
    }));
  }, [data, colors]);

  const total = React.useMemo(() => {
    return data.reduce((sum, item) => sum + item.value, 0);
  }, [data]);

  const renderChart = () => {
    if (type === "bar") {
      return (
        <BarChart data={dataWithColors} layout="vertical">
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            tickLine={false}
            axisLine={false}
            width={100}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {dataWithColors.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      );
    }

    // Pie or donut chart
    const innerRadius = type === "donut" ? 60 : 0;

    return (
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Pie
          data={dataWithColors}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={innerRadius}
          outerRadius={80}
          strokeWidth={2}
        >
          {dataWithColors.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.fill} />
          ))}
        </Pie>
        {showLegend && <ChartLegend content={<ChartLegendContent nameKey="name" />} />}
      </PieChart>
    );
  };

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col items-center pb-6">
        <ChartContainer
          config={chartConfig}
          className="w-full"
          style={{ height }}
        >
          {renderChart()}
        </ChartContainer>
        {type === "donut" && (
          <div className="text-center mt-2">
            <div className="text-2xl font-bold">{total.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground">Total</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
