package com.contoso.ledger.core;

import java.time.Instant;
import java.util.List;
import lombok.Value;

// Still a Lombok @Value class: no task has needed to change it since the Java 21 upgrade.
@Value
public class Journal {
    Long id;
    Instant postedAt;
    List<Posting> postings;

    public static Journal unsaved(List<Posting> postings) {
        return new Journal(null, Instant.now(), List.copyOf(postings));
    }
}
