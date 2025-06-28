import 'package:daily_task_app/viewmodels/task_viewmodel.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../generated/app_localizations.dart';
import '../models/task.dart'; // For Task type
import 'package:table_calendar/table_calendar.dart'; // Dependency needs to be added

class MonthlyProgressScreen extends StatefulWidget {
  const MonthlyProgressScreen({super.key});

  @override
  State<MonthlyProgressScreen> createState() => _MonthlyProgressScreenState();
}

class _MonthlyProgressScreenState extends State<MonthlyProgressScreen> {
  CalendarFormat _calendarFormat = CalendarFormat.month;
  DateTime _focusedDay = DateTime.now();
  DateTime? _selectedDay;
  Map<DateTime, List<Task>> _tasksByDay = {};
  Map<DateTime, double> _dailyCompletionRate = {};

  @override
  void initState() {
    super.initState();
    _selectedDay = _focusedDay;
    // Initial load of tasks for the visible month can be done here
    // For simplicity, we'll load tasks for the whole month when the viewmodel is ready
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadTasksForMonth(_focusedDay);
    });
  }

  Future<void> _loadTasksForMonth(DateTime monthDate) async {
    final taskViewModel = Provider.of<TaskViewModel>(context, listen: false);
    // This is a simplified approach. Ideally, TaskViewModel would have a method
    // to fetch all tasks for a given month.
    // For now, we'll iterate through days of the month and use existing getTasksForDate.
    // This is NOT efficient for a real app but demonstrates the concept.

    _tasksByDay.clear();
    _dailyCompletionRate.clear();

    final firstDayOfMonth = DateTime(monthDate.year, monthDate.month, 1);
    final lastDayOfMonth = DateTime(monthDate.year, monthDate.month + 1, 0);

    // Create a temporary TaskViewModel to avoid interfering with the main one's date
    // Or, add a new method to TaskViewModel: getTasksForMonthRange
    final dbHelper = Provider.of<TaskViewModel>(context, listen: false).getDbHelper(); // Need to expose dbHelper or add new method

    for (DateTime day = firstDayOfMonth;
         day.isBefore(lastDayOfMonth.add(const Duration(days: 1)));
         day = day.add(const Duration(days: 1))) {

      // This direct call to dbHelper is a temporary workaround
      // Ideally TaskViewModel.getTasksForDate(day) would be used,
      // but that changes the ViewModel's _currentDate.
      // A better solution is TaskViewModel.getTasksForSpecificDateWithoutChangingCurrent(day)
      // or TaskViewModel.getTasksForMonth(monthDate)
      List<Task> tasks = await dbHelper.getTasksForDate(day);
      if (tasks.isNotEmpty) {
        _tasksByDay[DateTime(day.year, day.month, day.day)] = tasks;
        int completed = tasks.where((t) => t.isCompleted).length;
        _dailyCompletionRate[DateTime(day.year, day.month, day.day)] = tasks.isEmpty ? 0.0 : completed / tasks.length.toDouble();
      }
    }
    if (mounted) {
      setState(() {});
    }
  }


  List<Task> _getEventsForDay(DateTime day) {
    return _tasksByDay[DateTime(day.year, day.month, day.day)] ?? [];
  }

  @override
  Widget build(BuildContext context) {
    final localizations = AppLocalizations.of(context)!;
    // final taskViewModel = Provider.of<TaskViewModel>(context); // Not directly used for calendar events here due to current loading strategy
     final textDirection = Directionality.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(localizations.monthlyProgress, textDirection: textDirection),
      ),
      body: Column(
        children: [
          TableCalendar<Task>(
            firstDay: DateTime.utc(2010, 10, 16),
            lastDay: DateTime.utc(2030, 3, 14),
            focusedDay: _focusedDay,
            selectedDayPredicate: (day) => isSameDay(_selectedDay, day),
            calendarFormat: _calendarFormat,
            eventLoader: _getEventsForDay,
            startingDayOfWeek: StartingDayOfWeek.monday, // Or based on locale
            calendarStyle: CalendarStyle(
              // Use `CalendarStyle` to customize the UI
              outsideDaysVisible: false,
              todayDecoration: BoxDecoration(
                color: Theme.of(context).primaryColor.withOpacity(0.5),
                shape: BoxShape.circle,
              ),
              selectedDecoration: BoxDecoration(
                color: Theme.of(context).primaryColor,
                shape: BoxShape.circle,
              ),
              markerDecoration: BoxDecoration( // Default marker for days with events
                  color: Theme.of(context).colorScheme.secondary, shape: BoxShape.circle),
            ),
            calendarBuilders: CalendarBuilders(
              markerBuilder: (context, date, events) {
                final dayKey = DateTime(date.year, date.month, date.day);
                if (_dailyCompletionRate.containsKey(dayKey) && _dailyCompletionRate[dayKey]! > 0) {
                  double completion = _dailyCompletionRate[dayKey]!;
                  Color markerColor;
                  if (completion == 1.0) {
                    markerColor = Colors.green; // All tasks completed
                  } else if (completion > 0.5) {
                    markerColor = Colors.orange; // More than half completed
                  } else {
                    markerColor = Colors.red; // Less than half or none
                  }
                  return Positioned(
                    right: 1,
                    bottom: 1,
                    child: Container(
                      width: 8,
                      height: 8,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: markerColor,
                      ),
                    ),
                  );
                }
                return null; // No marker if no tasks or no completion
              },
            ),
            onDaySelected: (selectedDay, focusedDay) {
              if (!isSameDay(_selectedDay, selectedDay)) {
                setState(() {
                  _selectedDay = selectedDay;
                  _focusedDay = focusedDay;
                });
                // Potentially load details for the selected day below the calendar
              }
            },
            onFormatChanged: (format) {
              if (_calendarFormat != format) {
                setState(() {
                  _calendarFormat = format;
                });
              }
            },
            onPageChanged: (focusedDay) {
              _focusedDay = focusedDay;
               _loadTasksForMonth(focusedDay); // Reload tasks for the new month
            },
            locale: localizations.localeName, // Set locale for calendar
          ),
          const SizedBox(height: 8.0),
          if (_selectedDay != null)
            Padding(
              padding: const EdgeInsets.all(8.0),
              child: Text(
                "${localizations.tasksForToday}: ${DateFormat.yMMMd(localizations.localeName).format(_selectedDay!)}",
                style: Theme.of(context).textTheme.titleMedium,
                textDirection: textDirection,
              ),
            ),
          Expanded(
            child: _selectedDay != null && _getEventsForDay(_selectedDay!).isNotEmpty
                ? ListView.builder(
                    itemCount: _getEventsForDay(_selectedDay!).length,
                    itemBuilder: (context, index) {
                      final task = _getEventsForDay(_selectedDay!)[index];
                      return Card(
                        margin: const EdgeInsets.symmetric(horizontal: 12.0, vertical: 4.0),
                        child: ListTile(
                          title: Text(task.name, style: TextStyle(decoration: task.isCompleted ? TextDecoration.lineThrough : null), textDirection: textDirection),
                          subtitle: Text(
                            "${DateFormat.jm(localizations.localeName).format(task.startTime)} - ${DateFormat.jm(localizations.localeName).format(task.endTime)}",
                             style: TextStyle(decoration: task.isCompleted ? TextDecoration.lineThrough : null), textDirection: textDirection
                          ),
                          trailing: Checkbox( // Non-interactive, just for display
                            value: task.isCompleted,
                            onChanged: null, // No action on tap here, this is a summary view
                          ),
                        ),
                      );
                    },
                  )
                : Center(
                    child: Text(
                      _selectedDay != null ? localizations.noTasksToday : "Select a day to see tasks", // TODO: Localize "Select a day"
                      textDirection: textDirection,
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

// Add to TaskViewModel to expose dbHelper or create a specific method for fetching tasks for a month.
// This is a temporary way to access it for the monthly view.
extension TaskViewModelDbHelper on TaskViewModel {
  DatabaseHelper getDbHelper() => _dbHelper;
}
