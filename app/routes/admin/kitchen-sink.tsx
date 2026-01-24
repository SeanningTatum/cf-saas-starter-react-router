"use client";

import * as React from "react";
import {
  AlertCircle,
  Bold,
  ChevronsUpDown,
  Inbox,
  Italic,
  Mail,
  Plus,
  Terminal,
  Underline,
} from "lucide-react";
import { toast } from "sonner";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarTrigger,
} from "@/components/ui/menubar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ScrollArea } from "@/components/ui/scroll-area";
// Note: Resizable component (react-resizable-panels) is not SSR-compatible with Cloudflare Workers
import { api } from "@/trpc/client";
import { SiteHeader } from "./layout/site-header";

export default function KitchenSink() {
  const createWorkflowMutation = api.user.createWorkflow.useMutation();
  const [isOpen, setIsOpen] = React.useState(false);
  const [progress, setProgress] = React.useState(33);
  const [sliderValue, setSliderValue] = React.useState([50]);
  const [date, setDate] = React.useState<Date | undefined>(new Date());

  React.useEffect(() => {
    const timer = setTimeout(() => setProgress(66), 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div>
      <SiteHeader title="Kitchen Sink" />
      <div className="space-y-12 p-6">
        {/* Layout Section */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Layout Components</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Accordion</CardTitle>
              </CardHeader>
              <CardContent>
                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="item-1">
                    <AccordionTrigger>Is it accessible?</AccordionTrigger>
                    <AccordionContent>Yes. WAI-ARIA compliant.</AccordionContent>
                  </AccordionItem>
                </Accordion>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Collapsible</CardTitle>
              </CardHeader>
              <CardContent>
                <Collapsible open={isOpen} onOpenChange={setIsOpen}>
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">@peduarte</h4>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <ChevronsUpDown className="h-4 w-4" />
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent className="mt-2">
                    <div className="rounded-md border px-4 py-2 text-sm">
                      Hidden content
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>AspectRatio</CardTitle>
              </CardHeader>
              <CardContent>
                <AspectRatio ratio={16 / 9} className="bg-muted rounded-md">
                  <div className="flex h-full items-center justify-center">
                    16:9
                  </div>
                </AspectRatio>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Empty State</CardTitle>
              </CardHeader>
              <CardContent>
                <Empty className="border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Inbox />
                    </EmptyMedia>
                    <EmptyTitle>No items</EmptyTitle>
                    <EmptyDescription>Add an item to start.</EmptyDescription>
                  </EmptyHeader>
                  <Button size="sm">
                    <Plus className="mr-2 h-4 w-4" />
                    Add
                  </Button>
                </Empty>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Forms Section */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Form Components</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Buttons</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button>Default</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>ButtonGroup</CardTitle>
              </CardHeader>
              <CardContent>
                <ButtonGroup>
                  <Button variant="outline">L</Button>
                  <Button variant="outline">M</Button>
                  <Button variant="outline">R</Button>
                </ButtonGroup>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Input</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Input placeholder="Email" />
                <Input disabled placeholder="Disabled" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>InputGroup</CardTitle>
              </CardHeader>
              <CardContent>
                <InputGroup>
                  <InputGroupAddon>
                    <InputGroupText>
                      <Mail className="h-4 w-4" />
                    </InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput placeholder="Email" />
                </InputGroup>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>InputOTP</CardTitle>
              </CardHeader>
              <CardContent>
                <InputOTP maxLength={6}>
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup>
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Textarea</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea placeholder="Message..." />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Select</CardTitle>
              </CardHeader>
              <CardContent>
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="a">Option A</SelectItem>
                    <SelectItem value="b">Option B</SelectItem>
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>NativeSelect</CardTitle>
              </CardHeader>
              <CardContent>
                <NativeSelect>
                  <option value="">Select</option>
                  <option value="1">Option 1</option>
                  <option value="2">Option 2</option>
                </NativeSelect>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Checkbox</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center space-x-2">
                  <Checkbox id="c1" />
                  <Label htmlFor="c1">Accept terms</Label>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>RadioGroup</CardTitle>
              </CardHeader>
              <CardContent>
                <RadioGroup defaultValue="1">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="1" id="r1" />
                    <Label htmlFor="r1">Option 1</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="2" id="r2" />
                    <Label htmlFor="r2">Option 2</Label>
                  </div>
                </RadioGroup>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Switch</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center space-x-2">
                  <Switch id="sw1" />
                  <Label htmlFor="sw1">Enabled</Label>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Slider</CardTitle>
              </CardHeader>
              <CardContent>
                <Slider
                  value={sliderValue}
                  onValueChange={setSliderValue}
                  max={100}
                />
                <p className="text-sm text-muted-foreground mt-2">
                  Value: {sliderValue}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Toggle</CardTitle>
              </CardHeader>
              <CardContent className="flex gap-2">
                <Toggle aria-label="Bold">
                  <Bold className="h-4 w-4" />
                </Toggle>
                <Toggle aria-label="Italic">
                  <Italic className="h-4 w-4" />
                </Toggle>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>ToggleGroup</CardTitle>
              </CardHeader>
              <CardContent>
                <ToggleGroup type="multiple">
                  <ToggleGroupItem value="b">
                    <Bold className="h-4 w-4" />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="i">
                    <Italic className="h-4 w-4" />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="u">
                    <Underline className="h-4 w-4" />
                  </ToggleGroupItem>
                </ToggleGroup>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Feedback Section */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Feedback Components</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Alert</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert>
                  <Terminal className="h-4 w-4" />
                  <AlertTitle>Notice</AlertTitle>
                  <AlertDescription>Something happened.</AlertDescription>
                </Alert>
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>Something went wrong.</AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Progress</CardTitle>
              </CardHeader>
              <CardContent>
                <Progress value={progress} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Skeleton</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center space-x-4">
                  <Skeleton className="h-12 w-12 rounded-full" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-[200px]" />
                    <Skeleton className="h-4 w-[150px]" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Spinner</CardTitle>
              </CardHeader>
              <CardContent className="flex gap-4">
                <Spinner />
                <Spinner className="h-8 w-8" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Toast</CardTitle>
              </CardHeader>
              <CardContent className="flex gap-2">
                <Button onClick={() => toast("Hello!")}>Toast</Button>
                <Button onClick={() => toast.success("Success!")}>
                  Success
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Data Display Section */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Data Display</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Avatar</CardTitle>
              </CardHeader>
              <CardContent className="flex gap-4">
                <Avatar>
                  <AvatarImage src="https://github.com/shadcn.png" />
                  <AvatarFallback>CN</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarFallback>JD</AvatarFallback>
                </Avatar>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Badge</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Badge>Default</Badge>
                <Badge variant="secondary">Secondary</Badge>
                <Badge variant="outline">Outline</Badge>
                <Badge variant="destructive">Destructive</Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Separator</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  <h4 className="text-sm font-medium">Radix Primitives</h4>
                  <p className="text-sm text-muted-foreground">UI library.</p>
                </div>
                <Separator className="my-4" />
                <div className="flex h-5 items-center space-x-4 text-sm">
                  <div>Blog</div>
                  <Separator orientation="vertical" />
                  <div>Docs</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Overlays Section */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Overlays</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Dialog</CardTitle>
              </CardHeader>
              <CardContent>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline">Edit Profile</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Edit profile</DialogTitle>
                      <DialogDescription>
                        Make changes to your profile here.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                      <Input placeholder="Name" />
                    </div>
                    <DialogFooter>
                      <Button type="submit">Save</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Drawer</CardTitle>
              </CardHeader>
              <CardContent>
                <Drawer>
                  <DrawerTrigger asChild>
                    <Button variant="outline">Open Drawer</Button>
                  </DrawerTrigger>
                  <DrawerContent>
                    <DrawerHeader>
                      <DrawerTitle>Drawer Title</DrawerTitle>
                      <DrawerDescription>Description here.</DrawerDescription>
                    </DrawerHeader>
                    <DrawerFooter>
                      <Button>Submit</Button>
                      <DrawerClose asChild>
                        <Button variant="outline">Cancel</Button>
                      </DrawerClose>
                    </DrawerFooter>
                  </DrawerContent>
                </Drawer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Sheet</CardTitle>
              </CardHeader>
              <CardContent>
                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="outline">Open Sheet</Button>
                  </SheetTrigger>
                  <SheetContent>
                    <SheetHeader>
                      <SheetTitle>Sheet Title</SheetTitle>
                      <SheetDescription>Description.</SheetDescription>
                    </SheetHeader>
                    <div className="py-4">
                      <Input placeholder="Name" />
                    </div>
                    <SheetFooter>
                      <Button>Save</Button>
                    </SheetFooter>
                  </SheetContent>
                </Sheet>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>AlertDialog</CardTitle>
              </CardHeader>
              <CardContent>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive">Delete</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction>Continue</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Popover</CardTitle>
              </CardHeader>
              <CardContent>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline">Open Popover</Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80">
                    <div className="space-y-2">
                      <h4 className="font-medium">Dimensions</h4>
                      <p className="text-sm text-muted-foreground">
                        Set the dimensions for the layer.
                      </p>
                    </div>
                  </PopoverContent>
                </Popover>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tooltip</CardTitle>
              </CardHeader>
              <CardContent>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline">Hover me</Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Add to library</p>
                  </TooltipContent>
                </Tooltip>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>HoverCard</CardTitle>
              </CardHeader>
              <CardContent>
                <HoverCard>
                  <HoverCardTrigger asChild>
                    <Button variant="link">@nextjs</Button>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-80">
                    <div className="space-y-1">
                      <h4 className="text-sm font-semibold">@nextjs</h4>
                      <p className="text-sm">The React Framework.</p>
                    </div>
                  </HoverCardContent>
                </HoverCard>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>ContextMenu</CardTitle>
              </CardHeader>
              <CardContent>
                <ContextMenu>
                  <ContextMenuTrigger className="flex h-[100px] w-full items-center justify-center rounded-md border border-dashed text-sm">
                    Right click here
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem>Back</ContextMenuItem>
                    <ContextMenuItem>Forward</ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>DropdownMenu</CardTitle>
              </CardHeader>
              <CardContent>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline">Open</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuLabel>My Account</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem>Profile</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Menubar</CardTitle>
              </CardHeader>
              <CardContent>
                <Menubar>
                  <MenubarMenu>
                    <MenubarTrigger>File</MenubarTrigger>
                    <MenubarContent>
                      <MenubarItem>New Tab</MenubarItem>
                    </MenubarContent>
                  </MenubarMenu>
                </Menubar>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Breadcrumb</CardTitle>
              </CardHeader>
              <CardContent>
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem>
                      <BreadcrumbLink href="#">Home</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>Current</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Pagination</CardTitle>
              </CardHeader>
              <CardContent>
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious href="#" />
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationLink href="#" isActive>
                        1
                      </PaginationLink>
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext href="#" />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tabs</CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="a">
                  <TabsList>
                    <TabsTrigger value="a">A</TabsTrigger>
                    <TabsTrigger value="b">B</TabsTrigger>
                  </TabsList>
                  <TabsContent value="a" className="mt-2 text-sm">
                    Content A
                  </TabsContent>
                  <TabsContent value="b" className="mt-2 text-sm">
                    Content B
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Table</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>INV001</TableCell>
                      <TableCell>$250</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Calendar</CardTitle>
              </CardHeader>
              <CardContent>
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  className="rounded-md border"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Carousel</CardTitle>
              </CardHeader>
              <CardContent>
                <Carousel className="w-full max-w-xs mx-auto">
                  <CarouselContent>
                    {[1, 2, 3].map((num) => (
                      <CarouselItem key={num}>
                        <Card>
                          <CardContent className="flex aspect-square items-center justify-center p-6">
                            <span className="text-4xl font-semibold">{num}</span>
                          </CardContent>
                        </Card>
                      </CarouselItem>
                    ))}
                  </CarouselContent>
                  <CarouselPrevious />
                  <CarouselNext />
                </Carousel>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Command</CardTitle>
              </CardHeader>
              <CardContent>
                <Command className="rounded-lg border shadow-md">
                  <CommandInput placeholder="Search..." />
                  <CommandList>
                    <CommandEmpty>No results.</CommandEmpty>
                    <CommandGroup heading="Suggestions">
                      <CommandItem>Calendar</CommandItem>
                      <CommandItem>Search</CommandItem>
                    </CommandGroup>
                  </CommandList>
                </Command>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>ScrollArea</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[100px] w-full">
                  <ScrollArea className="h-full w-full rounded-md border p-4">
                    {Array.from({ length: 10 }).map((_, i) => (
                      <div key={i} className="text-sm py-1">
                        Item {i + 1}
                      </div>
                    ))}
                  </ScrollArea>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Custom Section */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Custom</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Workflow Trigger</CardTitle>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={() => {
                    createWorkflowMutation.mutate({
                      email: "test@example.com",
                      metadata: { test: "test" },
                    });
                  }}
                >
                  Trigger Workflow
                </Button>
                {createWorkflowMutation.isPending && (
                  <p className="text-sm mt-2">Loading...</p>
                )}
                {createWorkflowMutation.isSuccess && (
                  <p className="text-sm text-green-600 mt-2">Success!</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
