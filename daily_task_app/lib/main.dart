import 'package:daily_task_app/screens/task_list_screen.dart';
import 'package:daily_task_app/services/notification_service.dart'; // Import NotificationService
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:provider/provider.dart';
import 'generated/app_localizations.dart';
import 'viewmodels/task_viewmodel.dart';

// Global variable to access AppLocalizations - it's generally better to use AppLocalizations.of(context)
// AppLocalizations? localizations; // This global variable is now initialized in _MyAppState's build method

void main() async {
  // Ensure Flutter bindings are initialized
  WidgetsFlutterBinding.ensureInitialized();

  // NotificationService().initialize() will be called in _MyAppState's initState
  // to ensure context is available if needed for localizations within the service.

  runApp(
    ChangeNotifierProvider(
      create: (context) => TaskViewModel(), // TaskViewModel might initialize DB
      child: const MyApp(),
    ),
  );
}

class MyApp extends StatefulWidget {
  const MyApp({super.key});

  static void setLocale(BuildContext context, Locale newLocale) {
    _MyAppState? state = context.findAncestorStateOfType<_MyAppState>();
    state?.setLocale(newLocale);
  }

  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  Locale _locale = const Locale('ku'); // Default to Kurdish
  // late AppLocalizations appLocalizationsInstance; // To pass to NotificationService

  @override
  void initState() {
    super.initState();
    // It's important to initialize NotificationService after the first frame
    // or when context is definitely available.
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      // The context passed here will be from the MyApp widget.
      await NotificationService().initialize(context);
    });
  }

  void setLocale(Locale locale) {
    setState(() {
      _locale = locale;
    });
  }

  @override
  Widget build(BuildContext context) {
    // AppLocalizations instance is obtained via AppLocalizations.of(context)
    // directly where needed, or can be stored if passed around.
    // For NotificationService, it now takes context in its schedule method.
    // appLocalizationsInstance = AppLocalizations.of(context) ?? lookupAppLocalizations(_locale);

    return MaterialApp(
      debugShowCheckedModeBanner: false,
      locale: _locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      onGenerateTitle: (BuildContext context) {
        return AppLocalizations.of(context)!.appTitle;
      },
      theme: ThemeData(
        primarySwatch: Colors.teal,
        visualDensity: VisualDensity.adaptivePlatformDensity,
        fontFamily: _locale.languageCode == 'ku' ? 'Vazirmatn' : null,
      ),
      home: const TaskListScreen(),
    );
  }
}
