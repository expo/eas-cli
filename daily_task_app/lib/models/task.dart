class Task {
  int? id;
  String name;
  String? description;
  DateTime startTime;
  DateTime endTime;
  bool isCompleted;
  String? category;
  String? targetGoal;
  double? progress; // Can be 0.0 to 1.0 or based on targetGoal
  DateTime createdAt;
  DateTime updatedAt;

  Task({
    this.id,
    required this.name,
    this.description,
    required this.startTime,
    required this.endTime,
    this.isCompleted = false,
    this.category,
    this.targetGoal,
    this.progress,
    required this.createdAt,
    required this.updatedAt,
  });

  factory Task.fromMap(Map<String, dynamic> map) {
    return Task(
      id: map['id'] as int?,
      name: map['name'] as String,
      description: map['description'] as String?,
      startTime: DateTime.parse(map['startTime'] as String),
      endTime: DateTime.parse(map['endTime'] as String),
      isCompleted: map['isCompleted'] == 1,
      category: map['category'] as String?,
      targetGoal: map['targetGoal'] as String?,
      progress: map['progress'] as double?,
      createdAt: DateTime.parse(map['createdAt'] as String),
      updatedAt: DateTime.parse(map['updatedAt'] as String),
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'name': name,
      'description': description,
      'startTime': startTime.toIso8601String(),
      'endTime': endTime.toIso8601String(),
      'isCompleted': isCompleted ? 1 : 0,
      'category': category,
      'targetGoal': targetGoal,
      'progress': progress,
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt.toIso8601String(),
    };
  }

  @override
  String toString() {
    return 'Task{id: $id, name: $name, startTime: $startTime, isCompleted: $isCompleted}';
  }

  // copyWith method for easy object updates
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
