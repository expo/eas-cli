// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: prefer_final_fields, public_member_api_docs, prefer_single_quotes, omit_local_variable_types, library_private_types_in_public_api

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_ku.dart';

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'generated/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you would edit this file
/// directly to list them supported locales.
///
/// ### References
///
///  - [Internationalizing Flutter apps](https://flutter.dev/docs/development/accessibility-and-localization/internationalization)
///  - [iOS Development Guide](https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/CoreFoundationKeys.html#//apple_ref/doc/uid/20001431-109680)
///  - [Development languages and regions](https://developer.apple.com/documentation/xcode/cza#DEVELOPMENT_LANGUAGE_AND_REGION)
abstract class AppLocalizations {
  AppLocalizations(String locale) : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations? of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations);
  }

  static const LocalizationsDelegate<AppLocalizations> delegate = _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates = <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of all locales supported by this application.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('ku')
  ];

  ///getter methods for all keys in app_en.arb and app_ku.arb
  String get appTitle;
  String get tasksForToday;
  String get noTasksToday;
  String get addTask;
  String get editTask;
  String get taskName;
  String get taskNameHint;
  String get taskDescription;
  String get taskDescriptionHint;
  String get startTime;
  String get endTime;
  String get category;
  String get categoryHint;
  String get targetGoal;
  String get targetGoalHint;
  String get saveTask;
  String get deleteTask;
  String get deleteTaskConfirmation;
  String get yes;
  String get no;
  String get fieldRequiredError;
  String get selectDate;
  String get selectTime;
  String get ok;
  String get cancel;
  String get progress;
  String get completed;
  String get incomplete;
  String get viewMonthlyProgress;
  String get dailyProgress;
  String get monthlyProgress;
  String get settings;
  String get language;
  String get english;
  String get kurdish;
  String get notifications;
  String get upcomingTask;
}

class _AppLocalizationsDelegate extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) => <String>['en', 'ku'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {

  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en': return AppLocalizationsEn();
    case 'ku': return AppLocalizationsKu();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.'
  );
}
