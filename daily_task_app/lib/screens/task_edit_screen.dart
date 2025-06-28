import 'package:daily_task_app/models/task.dart';
import 'package:daily_task_app/viewmodels/task_viewmodel.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../generated/app_localizations.dart';

class TaskEditScreen extends StatefulWidget {
  final Task? task; // Null if creating a new task
  final DateTime selectedDate; // To prefill date for new tasks

  const TaskEditScreen({super.key, this.task, required this.selectedDate});

  @override
  State<TaskEditScreen> createState() => _TaskEditScreenState();
}

class _TaskEditScreenState extends State<TaskEditScreen> {
  final _formKey = GlobalKey<FormState>();
  late TextEditingController _nameController;
  late TextEditingController _descriptionController;
  late TextEditingController _categoryController;
  late TextEditingController _targetGoalController;

  DateTime? _startTime;
  TimeOfDay? _startTimeOfDay;
  DateTime? _endTime;
  TimeOfDay? _endTimeOfDay;

  bool _isNewTask = true;

  @override
  void initState() {
    super.initState();
    _isNewTask = widget.task == null;

    _nameController = TextEditingController(text: widget.task?.name ?? '');
    _descriptionController =
        TextEditingController(text: widget.task?.description ?? '');
    _categoryController =
        TextEditingController(text: widget.task?.category ?? '');
    _targetGoalController =
        TextEditingController(text: widget.task?.targetGoal ?? '');

    if (widget.task != null) {
      _startTime = widget.task!.startTime;
      _startTimeOfDay = TimeOfDay.fromDateTime(_startTime!);
      _endTime = widget.task!.endTime;
      _endTimeOfDay = TimeOfDay.fromDateTime(_endTime!);
    } else {
      // For new tasks, prefill with current time or a sensible default on selectedDate
      _startTimeOfDay = TimeOfDay.now();
      _startTime = DateTime(widget.selectedDate.year, widget.selectedDate.month, widget.selectedDate.day, _startTimeOfDay!.hour, _startTimeOfDay!.minute);
      _endTimeOfDay = TimeOfDay(hour: (_startTimeOfDay!.hour + 1) % 24, minute: _startTimeOfDay!.minute); // Default 1 hour duration
      _endTime = DateTime(widget.selectedDate.year, widget.selectedDate.month, widget.selectedDate.day, _endTimeOfDay!.hour, _endTimeOfDay!.minute);
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    _categoryController.dispose();
    _targetGoalController.dispose();
    super.dispose();
  }

  Future<void> _selectStartTime(BuildContext context, AppLocalizations localizations) async {
    final TimeOfDay? pickedTime = await showTimePicker(
      context: context,
      initialTime: _startTimeOfDay ?? TimeOfDay.now(),
      helpText: localizations.selectTime,
      cancelText: localizations.cancel,
      confirmText: localizations.ok,
    );
    if (pickedTime != null) {
      setState(() {
        _startTimeOfDay = pickedTime;
        final datePart = widget.task?.startTime ?? widget.selectedDate;
        _startTime = DateTime(
            datePart.year, datePart.month, datePart.day, pickedTime.hour, pickedTime.minute);

        // Optional: auto-adjust end time if it's before new start time
        if (_endTime != null && _endTime!.isBefore(_startTime!)) {
            _endTimeOfDay = TimeOfDay(hour: (_startTimeOfDay!.hour + 1) % 24, minute: _startTimeOfDay!.minute);
            _endTime = DateTime(datePart.year, datePart.month, datePart.day, _endTimeOfDay!.hour, _endTimeOfDay!.minute);
        }
      });
    }
  }

  Future<void> _selectEndTime(BuildContext context, AppLocalizations localizations) async {
    final TimeOfDay? pickedTime = await showTimePicker(
      context: context,
      initialTime: _endTimeOfDay ?? TimeOfDay(hour: (_startTimeOfDay!.hour + 1) % 24, minute: _startTimeOfDay!.minute),
      helpText: localizations.selectTime,
      cancelText: localizations.cancel,
      confirmText: localizations.ok,
    );
    if (pickedTime != null) {
      setState(() {
        _endTimeOfDay = pickedTime;
         final datePart = widget.task?.endTime ?? widget.selectedDate;
        _endTime = DateTime(
            datePart.year, datePart.month, datePart.day, pickedTime.hour, pickedTime.minute);
      });
    }
  }


  void _saveTask() {
    if (_formKey.currentState!.validate()) {
      if (_startTime == null || _endTime == null) {
        // Should not happen if UI is correct, but good to have a check
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Please select start and end times.'))); // TODO: Localize
        return;
      }
      if (_endTime!.isBefore(_startTime!)) {
         ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('End time cannot be before start time.'))); // TODO: Localize
        return;
      }


      final taskViewModel = Provider.of<TaskViewModel>(context, listen: false);
      final now = DateTime.now();

      final taskToSave = Task(
        id: widget.task?.id,
        name: _nameController.text,
        description: _descriptionController.text.isEmpty
            ? null
            : _descriptionController.text,
        startTime: _startTime!,
        endTime: _endTime!,
        isCompleted: widget.task?.isCompleted ?? false,
        category: _categoryController.text.isEmpty
            ? null
            : _categoryController.text,
        targetGoal: _targetGoalController.text.isEmpty
            ? null
            : _targetGoalController.text,
        progress: widget.task?.progress, // Progress might be handled differently
        createdAt: widget.task?.createdAt ?? now,
        updatedAt: now,
      );

      if (_isNewTask) {
        taskViewModel.addTask(taskToSave);
      } else {
        taskViewModel.updateTask(taskToSave);
      }
      Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    final localizations = AppLocalizations.of(context)!;
    final textDirection = Directionality.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(_isNewTask ? localizations.addTask : localizations.editTask),
        actions: [
          if (!_isNewTask)
            IconButton(
              icon: const Icon(Icons.delete),
              onPressed: () {
                showDialog(
                  context: context,
                  builder: (BuildContext ctx) {
                    return AlertDialog(
                      title: Text(localizations.deleteTask, textDirection: textDirection),
                      content: Text(localizations.deleteTaskConfirmation, textDirection: textDirection),
                      actions: <Widget>[
                        TextButton(
                          child: Text(localizations.no, textDirection: textDirection),
                          onPressed: () => Navigator.of(ctx).pop(),
                        ),
                        TextButton(
                          child: Text(localizations.yes, textDirection: textDirection),
                          onPressed: () {
                            Provider.of<TaskViewModel>(context, listen: false)
                                .deleteTask(widget.task!.id!);
                            Navigator.of(ctx).pop(); // Close dialog
                            Navigator.of(context).pop(); // Close edit screen
                          },
                        ),
                      ],
                    );
                  },
                );
              },
            ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Form(
          key: _formKey,
          child: ListView(
            children: <Widget>[
              TextFormField(
                controller: _nameController,
                decoration: InputDecoration(
                  labelText: localizations.taskName,
                  hintText: localizations.taskNameHint,
                ),
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return localizations.fieldRequiredError;
                  }
                  return null;
                },
                textDirection: textDirection,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _descriptionController,
                decoration: InputDecoration(
                  labelText: localizations.taskDescription,
                  hintText: localizations.taskDescriptionHint,
                ),
                maxLines: 3,
                textDirection: textDirection,
              ),
              const SizedBox(height: 16),
              Row(
                children: <Widget>[
                  Expanded(
                    child: InkWell(
                      onTap: () => _selectStartTime(context, localizations),
                      child: InputDecorator(
                        decoration: InputDecoration(
                          labelText: localizations.startTime,
                        ),
                        child: Text(
                          _startTimeOfDay != null
                              ? _startTimeOfDay!.format(context)
                              : localizations.selectTime,
                          textDirection: textDirection,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: InkWell(
                      onTap: () => _selectEndTime(context, localizations),
                      child: InputDecorator(
                        decoration: InputDecoration(
                          labelText: localizations.endTime,
                        ),
                        child: Text(
                          _endTimeOfDay != null
                              ? _endTimeOfDay!.format(context)
                              : localizations.selectTime,
                           textDirection: textDirection,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _categoryController,
                decoration: InputDecoration(
                  labelText: localizations.category,
                  hintText: localizations.categoryHint,
                ),
                textDirection: textDirection,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _targetGoalController,
                decoration: InputDecoration(
                  labelText: localizations.targetGoal,
                  hintText: localizations.targetGoalHint,
                ),
                textDirection: textDirection,
              ),
              const SizedBox(height: 32),
              ElevatedButton(
                onPressed: _saveTask,
                child: Text(localizations.saveTask, textDirection: textDirection),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
