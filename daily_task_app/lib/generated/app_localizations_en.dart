// ignore_for_file: unnecessary_brace_in_string_interps

import 'app_localizations.dart';

//ignore_for_file: non_constant_identifier_names, lines_longer_than_80_chars
//ignore_for_file: unnecessary_lambdas, prefer_expression_function_bodies, mark_<y_bin_385>function_body_wrapper_as_sync, use_super_parameters

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Today';

  @override
  String get tasksForToday => 'Tasks for Today';

  @override
  String get noTasksToday => 'No tasks for today. Add some!';

  @override
  String get addTask => 'Add Task';

  @override
  String get editTask => 'Edit Task';

  @override
  String get taskName => 'Task Name';

  @override
  String get taskNameHint => 'e.g., Read a book';

  @override
  String get taskDescription => 'Description (Optional)';

  @override
  String get taskDescriptionHint => 'e.g., Chapter 3 of \'The Alchemist\'';

  @override
  String get startTime => 'Start Time';

  @override
  String get endTime => 'End Time';

  @override
  String get category => 'Category (Optional)';

  @override
  String get categoryHint => 'e.g., Learning, Fitness';

  @override
  String get targetGoal => 'Target/Goal (Optional)';

  @override
  String get targetGoalHint => 'e.g., 30 minutes, 10 pages';

  @override
  String get saveTask => 'Save Task';

  @override
  String get deleteTask => 'Delete Task';

  @override
  String get deleteTaskConfirmation => 'Are you sure you want to delete this task?';

  @override
  String get yes => 'Yes';

  @override
  String get no => 'No';

  @override
  String get fieldRequiredError => 'This field is required.';

  @override
  String get selectDate => 'Select Date';

  @override
  String get selectTime => 'Select Time';

  @override
  String get ok => 'OK';

  @override
  String get cancel => 'Cancel';

  @override
  String get progress => 'Progress';

  @override
  String get completed => 'Completed';

  @override
  String get incomplete => 'Incomplete';

  @override
  String get viewMonthlyProgress => 'View Monthly Progress';

  @override
  String get dailyProgress => 'Daily Progress';

  @override
  String get monthlyProgress => 'Monthly Progress';

  @override
  String get settings => 'Settings';

  @override
  String get language => 'Language';

  @override
  String get english => 'English';

  @override
  String get kurdish => 'Kurdish (Sorani)';

  @override
  String get notifications => 'Notifications';

  @override
  String get upcomingTask => 'Upcoming Task';
}
