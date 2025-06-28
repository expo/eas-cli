import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest_all.dart' as tz;
import 'package:timezone/timezone.dart' as tz;
import '../models/task.dart'; // Your Task model
import '../generated/app_localizations.dart'; // For localized strings
import 'package:flutter/material.dart'; // For BuildContext -> AppLocalizations

class NotificationService {
  static final NotificationService _notificationService = NotificationService._internal();

  factory NotificationService() {
    return _notificationService;
  }

  NotificationService._internal();

  final FlutterLocalNotificationsPlugin flutterLocalNotificationsPlugin =
      FlutterLocalNotificationsPlugin();

  Future<void> initialize(BuildContext context) async {
    // Initialize timezone database
    tz.initializeTimeZones();
    // Set the local time zone
    // This should ideally get the device's actual timezone.
    // For now, using a common one or UTC. For more accuracy, consider `flutter_native_timezone`.
    try {
      // final String currentTimeZone = await FlutterNativeTimezone.getLocalTimezone();
      // tz.setLocalLocation(tz.getLocation(currentTimeZone));
      tz.setLocalLocation(tz.getLocation('Asia/Baghdad')); // Example: Set to Baghdad time
    } catch (e) {
      print('Could not get local timezone: $e');
      // Fallback to UTC if timezone fetching fails
      tz.setLocalLocation(tz.getLocation('UTC'));
    }


    const AndroidInitializationSettings initializationSettingsAndroid =
        AndroidInitializationSettings('@mipmap/ic_launcher'); // Ensure you have this icon

    const DarwinInitializationSettings initializationSettingsIOS =
        DarwinInitializationSettings(
      requestAlertPermission: true,
      requestBadgePermission: true,
      requestSoundPermission: true,
      // onDidReceiveLocalNotification: onDidReceiveLocalNotification, // For older iOS versions
    );

    final InitializationSettings initializationSettings = InitializationSettings(
      android: initializationSettingsAndroid,
      iOS: initializationSettingsIOS,
    );

    await flutterLocalNotificationsPlugin.initialize(
      initializationSettings,
      // onDidReceiveNotificationResponse: onDidReceiveNotificationResponse, // Handle notification tap
    );

    // Request permissions for Android 13+
    final AndroidFlutterLocalNotificationsPlugin? androidImplementation =
        flutterLocalNotificationsPlugin.resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>();
    await androidImplementation?.requestExactAlarmsPermission(); // For exact scheduling
    await androidImplementation?.requestNotificationsPermission(); // General notification permission

     // Request permissions for iOS
    await flutterLocalNotificationsPlugin
        .resolvePlatformSpecificImplementation<
            IOSFlutterLocalNotificationsPlugin>()
        ?.requestPermissions(
          alert: true,
          badge: true,
          sound: true,
        );
  }

  // static void onDidReceiveNotificationResponse(NotificationResponse response) {
  //   // Handle notification tap - e.g., navigate to a specific screen
  //   print('Notification Tapped: ${response.payload}');
  //   // Example: MyApp.navigatorKey.currentState?.pushNamed('/task-details', arguments: response.payload);
  // }

  Future<void> scheduleTaskNotification(Task task, AppLocalizations localizations) async {
    if (task.id == null) return; // Need an ID for the notification

    // Ensure task start time is in the future
    if (task.startTime.isBefore(DateTime.now())) {
      // Optionally, log this or handle it (e.g., don't schedule past tasks)
      print("Task ${task.name} is in the past. Notification not scheduled.");
      return;
    }

    // Use tz.TZDateTime for scheduled notifications
    final tz.TZDateTime scheduledTime = tz.TZDateTime.from(task.startTime, tz.local);

    // Check again if the TZDateTime is in the past (after conversion)
    if (scheduledTime.isBefore(tz.TZDateTime.now(tz.local))) {
         print("Task ${task.name} (TZTime) is in the past. Notification not scheduled.");
        return;
    }


    const AndroidNotificationDetails androidNotificationDetails =
        AndroidNotificationDetails(
      'daily_task_channel_id', // Channel ID
      'Daily Task Reminders', // Channel Name
      channelDescription: 'Channel for daily task reminder notifications',
      importance: Importance.max,
      priority: Priority.high,
      showWhen: true,
      // sound: RawResourceAndroidNotificationSound('notification_sound'), // if you have a custom sound
      // icon: '@mipmap/ic_notification', // if you have a specific notification icon
    );

    const DarwinNotificationDetails iOSNotificationDetails =
        DarwinNotificationDetails(
      presentAlert: true,
      presentBadge: true,
      presentSound: true,
    );

    const NotificationDetails notificationDetails = NotificationDetails(
      android: androidNotificationDetails,
      iOS: iOSNotificationDetails,
    );

    await flutterLocalNotificationsPlugin.zonedSchedule(
      task.id!, // Use task's DB id as notification id
      localizations.upcomingTask, // Title from localizations
      task.name, // Body is the task name
      scheduledTime,
      notificationDetails,
      androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
      uiLocalNotificationDateInterpretation:
          UILocalNotificationDateInterpretation.absoluteTime,
      payload: 'task_id=${task.id}', // Optional payload
      // matchDateTimeComponents: DateTimeComponents.time, // If it's a recurring daily notification at a specific time
    );
    print("Scheduled notification for task: ${task.name} at ${task.startTime} (TZ: $scheduledTime)");
  }

  Future<void> cancelTaskNotification(int taskId) async {
    await flutterLocalNotificationsPlugin.cancel(taskId);
    print("Cancelled notification for task ID: $taskId");
  }

  Future<void> cancelAllNotifications() async {
    await flutterLocalNotificationsPlugin.cancelAll();
     print("Cancelled all notifications");
  }
}
