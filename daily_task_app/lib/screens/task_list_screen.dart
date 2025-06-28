import 'package:daily_task_app/models/task.dart';
import 'package:daily_task_app/screens/monthly_progress_screen.dart';
import 'package:daily_task_app/screens/task_edit_screen.dart';
import 'package:daily_task_app/viewmodels/task_viewmodel.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../generated/app_localizations.dart';
import '../main.dart';

class TaskListScreen extends StatefulWidget {
  const TaskListScreen({super.key});

  @override
  State<TaskListScreen> createState() => _TaskListScreenState();
}

class _TaskListScreenState extends State<TaskListScreen> {
  DateTime _selectedDate = DateTime.now();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      Provider.of<TaskViewModel>(context, listen: false)
          .loadTasksForDate(_selectedDate);
    });
  }

  Future<void> _selectDate(BuildContext context) async {
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: _selectedDate,
      firstDate: DateTime(2000),
      lastDate: DateTime(2101),
    );
    if (picked != null && picked != _selectedDate) {
      setState(() {
        _selectedDate = picked;
      });
      Provider.of<TaskViewModel>(context, listen: false)
          .loadTasksForDate(_selectedDate);
    }
  }

  void _navigateToEditScreen(Task? task) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => TaskEditScreen(task: task, selectedDate: _selectedDate),
      ),
    ).then((_) {
      Provider.of<TaskViewModel>(context, listen: false).loadTasksForDate(_selectedDate);
    });
  }

  @override
  Widget build(BuildContext context) {
    final localizations = AppLocalizations.of(context)!;
    final taskViewModel = Provider.of<TaskViewModel>(context);
    final textDirection = Directionality.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(localizations.appTitle),
        actions: [
          IconButton(
            icon: const Icon(Icons.calendar_today),
            onPressed: () => _selectDate(context),
          ),
          PopupMenuButton<Locale>(
            icon: const Icon(Icons.language),
            onSelected: (Locale locale) {
               MyApp.setLocale(context, locale);
            },
            itemBuilder: (BuildContext context) => <PopupMenuEntry<Locale>>[
              PopupMenuItem<Locale>(
                value: const Locale('en'),
                child: Text(localizations.english),
              ),
              PopupMenuItem<Locale>(
                value: const Locale('ku'),
                child: Text(localizations.kurdish),
              ),
            ],
          ),
          IconButton(
            icon: const Icon(Icons.calendar_month_outlined),
            tooltip: localizations.viewMonthlyProgress,
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (context) => const MonthlyProgressScreen()),
              );
            },
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Text(
              "${localizations.tasksForToday} - ${DateFormat.yMMMd(localizations.localeName).format(_selectedDate)}",
              style: Theme.of(context).textTheme.headlineSmall,
              textDirection: textDirection,
            ),
          ),
          Expanded(
            child: taskViewModel.isLoading
                ? const Center(child: CircularProgressIndicator())
                : Column(
                    children: [
                      if (taskViewModel.tasks.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Text(
                                "${localizations.dailyProgress}: ${taskViewModel.completedTasksCount} / ${taskViewModel.totalTasksCount} ${localizations.completed.toLowerCase()}",
                                style: Theme.of(context).textTheme.titleMedium,
                                textDirection: textDirection,
                              ),
                              const SizedBox(height: 4),
                              LinearProgressIndicator(
                                value: taskViewModel.dailyProgress,
                                backgroundColor: Colors.grey[300],
                                valueColor: AlwaysStoppedAnimation<Color>(Theme.of(context).primaryColor),
                                minHeight: 10,
                                borderRadius: BorderRadius.circular(5),
                              ),
                              const SizedBox(height: 10),
                            ],
                          ),
                        ),
                      Expanded(
                        child: taskViewModel.tasks.isEmpty
                            ? Center(child: Text(localizations.noTasksToday, textDirection: textDirection,))
                            : ListView.builder(
                                itemCount: taskViewModel.tasks.length,
                                itemBuilder: (context, index) {
                                  final task = taskViewModel.tasks[index];
                                  return Card(
                                    margin: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
                                    child: ListTile(
                                      title: Text(task.name, style: TextStyle(decoration: task.isCompleted ? TextDecoration.lineThrough : null), textDirection: textDirection),
                                      subtitle: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          if (task.description != null && task.description!.isNotEmpty)
                                            Text(task.description!, style: TextStyle(decoration: task.isCompleted ? TextDecoration.lineThrough : null),textDirection: textDirection),
                                          Text(
                                            "${DateFormat.jm(localizations.localeName).format(task.startTime)} - ${DateFormat.jm(localizations.localeName).format(task.endTime)}",
                                            style: Theme.of(context).textTheme.bodySmall?.copyWith(decoration: task.isCompleted ? TextDecoration.lineThrough : null),
                                            textDirection: textDirection,
                                          ),
                                        ],
                                      ),
                                      trailing: Checkbox(
                                        value: task.isCompleted,
                                        onChanged: (bool? value) {
                                          if (value != null) {
                                            taskViewModel.toggleTaskCompletion(task, value, localizations); // Pass localizations
                                          }
                                        },
                                      ),
                                      onTap: () => _navigateToEditScreen(task),
                                      onLongPress: () {
                                        showDialog(
                                          context: context,
                                          builder: (BuildContext ctx) {
                                            return AlertDialog(
                                              title: Text(localizations.deleteTask, textDirection: textDirection),
                                              content: Text(localizations.deleteTaskConfirmation, textDirection: textDirection),
                                              actions: <Widget>[
                                                TextButton(
                                                  child: Text(localizations.no, textDirection: textDirection),
                                                  onPressed: () {
                                                    Navigator.of(ctx).pop();
                                                  },
                                                ),
                                                TextButton(
                                                  child: Text(localizations.yes, textDirection: textDirection),
                                                  onPressed: () {
                                                    taskViewModel.deleteTask(task.id!);
                                                    Navigator.of(ctx).pop();
                                                  },
                                                ),
                                              ],
                                            );
                                          },
                                        );
                                      },
                                    ),
                                  );
                                },
                              ),
                      ),
                    ],
                  ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _navigateToEditScreen(null),
        tooltip: localizations.addTask,
        child: const Icon(Icons.add),
      ),
    );
  }
}
