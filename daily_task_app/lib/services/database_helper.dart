import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import 'package:path_provider/path_provider.dart';
import 'dart:io';
import '../models/task.dart';

class DatabaseHelper {
  static const _databaseName = "TaskDatabase.db";
  static const _databaseVersion = 1;

  static const tableTasks = 'tasks';

  static const columnId = 'id';
  static const columnName = 'name';
  static const columnDescription = 'description';
  static const columnStartTime = 'startTime';
  static const columnEndTime = 'endTime';
  static const columnIsCompleted = 'isCompleted';
  static const columnCategory = 'category';
  static const columnTargetGoal = 'targetGoal';
  static const columnProgress = 'progress';
  static const columnCreatedAt = 'createdAt';
  static const columnUpdatedAt = 'updatedAt';

  // Make this a singleton class
  DatabaseHelper._privateConstructor();
  static final DatabaseHelper instance = DatabaseHelper._privateConstructor();

  // Only have a single app-wide reference to the database
  static Database? _database;
  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDatabase();
    return _database!;
  }

  // Open the database, creating if it doesn't exist
  _initDatabase() async {
    Directory documentsDirectory = await getApplicationDocumentsDirectory();
    String path = join(documentsDirectory.path, _databaseName);
    return await openDatabase(path,
        version: _databaseVersion,
        onCreate: _onCreate);
  }

  // SQL code to create the database table
  Future _onCreate(Database db, int version) async {
    await db.execute('''
          CREATE TABLE $tableTasks (
            $columnId INTEGER PRIMARY KEY AUTOINCREMENT,
            $columnName TEXT NOT NULL,
            $columnDescription TEXT,
            $columnStartTime TEXT NOT NULL,
            $columnEndTime TEXT NOT NULL,
            $columnIsCompleted INTEGER NOT NULL DEFAULT 0,
            $columnCategory TEXT,
            $columnTargetGoal TEXT,
            $columnProgress REAL,
            $columnCreatedAt TEXT NOT NULL,
            $columnUpdatedAt TEXT NOT NULL
          )
          ''');
  }

  // Helper methods

  // Inserts a row in the database where each key in the Map is a column name
  // and the value is the column value. The return value is the id of the
  // inserted row.
  Future<int> insertTask(Task task) async {
    Database db = await instance.database;
    return await db.insert(tableTasks, task.toMap());
  }

  // All of the rows are returned as a list of maps, where each map is
  // a key-value list of columns.
  Future<List<Task>> getAllTasks() async {
    Database db = await instance.database;
    final List<Map<String, dynamic>> maps = await db.query(tableTasks);
    if (maps.isEmpty) {
        return [];
    }
    return List.generate(maps.length, (i) {
      return Task.fromMap(maps[i]);
    });
  }

  // Retrieves a single task by ID
  Future<Task?> getTask(int id) async {
    Database db = await instance.database;
    List<Map<String, dynamic>> maps = await db.query(tableTasks,
        where: '$columnId = ?',
        whereArgs: [id]);
    if (maps.isNotEmpty) {
      return Task.fromMap(maps.first);
    }
    return null;
  }

  // Get tasks for a specific date (day)
  // Assumes startTime is stored in a way that allows date comparison
  Future<List<Task>> getTasksForDate(DateTime date) async {
    Database db = await instance.database;
    // Normalize date to compare just the date part (YYYY-MM-DD)
    String dateString = date.toIso8601String().substring(0, 10);

    final List<Map<String, dynamic>> maps = await db.query(
      tableTasks,
      where: "substr($columnStartTime, 1, 10) = ?",
      whereArgs: [dateString],
      orderBy: "$columnStartTime ASC"
    );

    if (maps.isEmpty) {
        return [];
    }
    return List.generate(maps.length, (i) {
      return Task.fromMap(maps[i]);
    });
  }


  // We are assuming here that the id column in the map is set. The other
  // column values will be used to update the row.
  Future<int> updateTask(Task task) async {
    Database db = await instance.database;
    return await db.update(tableTasks, task.toMap(),
        where: '$columnId = ?', whereArgs: [task.id]);
  }

  // Deletes the row specified by the id. The number of affected rows is
  // returned. This should be 1 as long as the row exists.
  Future<int> deleteTask(int id) async {
    Database db = await instance.database;
    return await db.delete(tableTasks, where: '$columnId = ?', whereArgs: [id]);
  }
}
