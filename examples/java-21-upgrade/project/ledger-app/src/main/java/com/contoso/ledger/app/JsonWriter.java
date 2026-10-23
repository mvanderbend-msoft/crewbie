package com.contoso.ledger.app;

import java.lang.reflect.Method;
import java.lang.reflect.RecordComponent;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.StringJoiner;

/**
 * Minimal reflection-based JSON for the API. Records are written from their components and other classes from
 * get* methods (Journal is still a Lombok class). Money is always a string so its scale survives.
 */
final class JsonWriter {
    private JsonWriter() {
    }

    static String write(Object value) {
        return switch (value) {
            case null -> "null";
            case String s -> quote(s);
            case BigDecimal amount -> quote(amount.toPlainString());
            case Number number -> number.toString();
            case Boolean bool -> bool.toString();
            case Enum<?> constant -> quote(constant.name());
            case Instant instant -> quote(instant.toString());
            case Collection<?> items -> array(items);
            case Map<?, ?> map -> object(map.entrySet().stream().map(e -> new Field(e.getKey().toString(), e.getValue())).toList());
            case Record record -> object(recordFields(record));
            default -> object(getterFields(value));
        };
    }

    private record Field(String name, Object value) {
    }

    private static List<Field> recordFields(Record record) {
        List<Field> fields = new ArrayList<>();
        for (RecordComponent component : record.getClass().getRecordComponents()) {
            fields.add(new Field(component.getName(), invoke(component.getAccessor(), record)));
        }
        return fields;
    }

    private static List<Field> getterFields(Object bean) {
        List<Field> fields = new ArrayList<>();
        for (Method method : bean.getClass().getMethods()) {
            String name = method.getName();
            if (name.startsWith("get") && name.length() > 3 && method.getParameterCount() == 0 && !name.equals("getClass")) {
                fields.add(new Field(Character.toLowerCase(name.charAt(3)) + name.substring(4), invoke(method, bean)));
            }
        }
        fields.sort((a, b) -> a.name().compareTo(b.name()));
        return fields;
    }

    private static Object invoke(Method method, Object target) {
        try {
            return method.invoke(target);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("Cannot read " + method.getName(), e);
        }
    }

    private static String object(List<Field> fields) {
        StringJoiner json = new StringJoiner(",", "{", "}");
        fields.forEach(field -> json.add(quote(field.name()) + ":" + write(field.value())));
        return json.toString();
    }

    private static String array(Collection<?> items) {
        StringJoiner json = new StringJoiner(",", "[", "]");
        items.forEach(item -> json.add(write(item)));
        return json.toString();
    }

    private static String quote(String text) {
        return "\"" + text.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }
}
