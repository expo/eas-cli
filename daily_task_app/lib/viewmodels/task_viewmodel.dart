import 'package:flutter/material.dart'; // Required for BuildContext for AppLocalizations
import '../models/task.dart';
import '../services/database_helper.dart';
import '../services/notification_service.dart'; // Import NotificationService
import '../generated/app_localizations.dart'; // Import AppLocalizations
import 'dart:collection'; // For UnmodifiableListView

class TaskViewModel extends ChangeNotifier {
  final DatabaseHelper _dbHelper = DatabaseHelper.instance;
  final NotificationService _notificationService = NotificationService();

  List<Task> _tasks = [];
  UnmodifiableListView<Task> get tasks => UnmodifiableListView(_tasks);

  bool _isLoading = false;
  bool get isLoading => _isLoading;

  DateTime _currentDate = DateTime.now();
  DateTime get currentDate => _currentDate;

  int get totalTasksCount => _tasks.length;
  int get completedTasksCount => _tasks.where((task) => task.isCompleted).length;
  double get dailyProgress => totalTasksCount == 0 ? 0.0 : completedTasksCount / totalTasksCount.toDouble();

  TaskViewModel() {
    // loadTasksForDate(_currentDate);
  }

  void _setLoading(bool loading) {
    _isLoading = loading;
    notifyListeners();
  }

  Future<void> loadTasksForDate(DateTime date) async {
    _setLoading(true);
    _currentDate = DateTime(date.year, date.month, date.day);
    _tasks = await _dbHelper.getTasksForDate(_currentDate);
    _setLoading(false);
  }

  // Method to get AppLocalizations - requires BuildContext
  // This is a bit tricky in a ViewModel. Ideally, UI passes Localizations.
  // For now, the NotificationService's schedule method takes localizations directly.
  // AppLocalizations _getAppLocalizations(BuildContext context) {
  //   return AppLocalizations.of(context)!;
  // }

  Future<void> addTask(Task task, AppLocalizations localizations) async {
    Task newTask = task.copyWith(id: await _dbHelper.insertTask(task)); // Get ID for notification
    if (newTask.id != null) {
      await _notificationService.scheduleTaskNotification(newTask, localizations);
    }

    if (task.startTime.year == _currentDate.year &&
        task.startTime.month == _currentDate.month &&
        task.startTime.day == _currentDate.day) {
      await loadTasksForDate(_currentDate);
    }
  }

  Future<void> updateTask(Task task, AppLocalizations localizations) async {
    await _dbHelper.updateTask(task);
    // Cancel old notification and schedule new one if start time changed or task is not completed
    await _notificationService.cancelTaskNotification(task.id!);
    if (!task.isCompleted) { // Only reschedule if not completed
      await _notificationService.scheduleTaskNotification(task, localizations);
    }
    await loadTasksForDate(_currentDate);
  }

  Future<void> deleteTask(int id) async {
    await _dbHelper.deleteTask(id);
    await _notificationService.cancelTaskNotification(id);
    await loadTasksForDate(_currentDate);
  }

  Future<void> toggleTaskCompletion(Task task, bool isCompleted, AppLocalizations localizations) async {
    task.isCompleted = isCompleted;
    task.updatedAt = DateTime.now();
    await _dbHelper.updateTask(task);

    if (isCompleted) {
      await _notificationService.cancelTaskNotification(task.id!);
    } else {
      // If marking as incomplete, reschedule notification
      await _notificationService.scheduleTaskNotification(task, localizations);
    }

    final index = _tasks.indexWhere((t) => t.id == task.id);
    if (index != -1) {
      _tasks[index] = task;
      notifyListeners();
    } else {
      await loadTasksForDate(_currentDate);
    }
  }
}

// Add copyWith to Task model if it doesn't exist
extension TaskCopyWith on Task {
  Task copyWith({
    int? id,
    String? name,
    String? description,
    DateTime? startTime,
    DateTime? endTime,
    bool? isCompleted,
    String? category,
    String? targetGoal,
    double? progress,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return Task(
      id: id ?? this.id,
      name: name ?? this.name,
      description: description ?? this.description,
      startTime: startTime ?? this.startTime,
      endTime: endTime ?? this.endTime,
      isCompleted: isCompleted ?? this.isCompleted,
      category: category ?? this.category,
      targetGoal: targetGoal ?? this.targetGoal,
      progress: progress ?? this.progress,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }
}
