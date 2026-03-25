import * as React from "react"
import { format } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface DatePickerWithRangeProps extends React.HTMLAttributes<HTMLDivElement> {
  date: {
    from: Date
    to: Date
  }
  setDate: (date: { from: Date; to: Date }) => void
}

export function DatePickerWithRange({
  className,
  date,
  setDate,
}: DatePickerWithRangeProps) {
  // We use a local state to handle the intermediate selection step where `to` might be undefined
  const [selected, setSelected] = React.useState<{ from?: Date; to?: Date }>({
    from: date.from,
    to: date.to,
  })

  // Sync incoming props to local state if they change externally (like hitting a Preset button)
  React.useEffect(() => {
    setSelected({ from: date.from, to: date.to })
  }, [date.from, date.to])

  const handleSelect = (range: { from?: Date; to?: Date } | undefined) => {
    if (!range) {
      // You can't deselect completely in this tracker app
      return 
    }
    
    setSelected(range)

    // Once both dates are selected, save it upwards
    if (range.from && range.to) {
      setDate({ from: range.from, to: range.to })
    }
  }

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant={"outline"}
            className={cn(
              "w-[240px] justify-start text-left font-normal bg-background/50 h-9",
              !date && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date?.from ? (
              date.to ? (
                <>
                  {format(date.from, "LLL dd, yyyy")} -{" "}
                  {format(date.to, "LLL dd, yyyy")}
                </>
              ) : (
                format(date.from, "LLL dd, yyyy")
              )
            ) : (
              <span>Pick a date</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={selected?.from}
            selected={selected as any}
            onSelect={handleSelect as any}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
